import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from './db';
import { AppError, audit, unitLabel } from './util';
import { localParts } from '../shared/evaluate';
import { randomId } from '../shared/encoding';
import { normalisePhone } from '../shared/phone';
import type { EventKind, EventMethod, PassType } from '../shared/types';

export interface LogFilter {
	from?: Date;
	to?: Date;
	unitId?: string;
	gateId?: string;
	kind?: EventKind;
	method?: EventMethod;
	passType?: PassType;
	q?: string;
	conflictsOnly?: boolean;
	limit?: number;
	offset?: number;
}

export async function listEvents(estateId: string, f: LogFilter) {
	const db = await getDb();
	const conds: SQL[] = [eq(schema.accessEvents.estateId, estateId)];
	if (f.from) conds.push(gte(schema.accessEvents.deviceTs, f.from));
	if (f.to) conds.push(lt(schema.accessEvents.deviceTs, f.to));
	if (f.unitId) conds.push(eq(schema.accessEvents.unitId, f.unitId));
	if (f.gateId) conds.push(eq(schema.accessEvents.gateId, f.gateId));
	if (f.kind) conds.push(eq(schema.accessEvents.kind, f.kind));
	if (f.method) conds.push(eq(schema.accessEvents.method, f.method));
	if (f.passType) conds.push(eq(schema.accessEvents.passType, f.passType));
	if (f.conflictsOnly) conds.push(eq(schema.accessEvents.conflict, true));
	if (f.q) {
		const like = `%${f.q.replace(/[%_]/g, '')}%`;
		conds.push(or(ilike(schema.accessEvents.visitorName, like), ilike(schema.accessEvents.guardName, like), ilike(schema.accessEvents.reason, like))!);
	}
	const rows = await db
		.select({ e: schema.accessEvents, unit: schema.units, gateName: schema.gates.name })
		.from(schema.accessEvents)
		.leftJoin(schema.units, eq(schema.units.id, schema.accessEvents.unitId))
		.leftJoin(schema.gates, eq(schema.gates.id, schema.accessEvents.gateId))
		.where(and(...conds))
		.orderBy(desc(schema.accessEvents.deviceTs))
		.limit(Math.min(f.limit ?? 100, 5000))
		.offset(f.offset ?? 0);
	return rows.map((r) => ({ ...r.e, unitLabel: r.unit ? unitLabel(r.unit) : '', gateName: r.gateName ?? '' }));
}

export function eventsToCsv(rows: Awaited<ReturnType<typeof listEvents>>, timeZone: string): string {
	const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'short', timeStyle: 'medium' });
	const esc = (v: unknown) => {
		const s = String(v ?? '');
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const header = ['time', 'gate', 'kind', 'method', 'pass_type', 'visitor', 'house', 'guard', 'reason', 'recorded_offline', 'conflict'];
	const lines = rows.map((r) =>
		[fmt.format(r.deviceTs), r.gateName, r.kind, r.method, r.passType ?? '', r.visitorName, r.unitLabel, r.guardName, r.reason, r.offline ? 'yes' : 'no', r.conflict ? 'yes' : 'no']
			.map(esc)
			.join(',')
	);
	return [header.join(','), ...lines].join('\n');
}

/** Visitors who entered and have no matching exit yet (per pass or per name for walk-ins). */
export async function insideNow(estateId: string, hours = 24) {
	const events = await listEvents(estateId, { from: new Date(Date.now() - hours * 3_600_000), limit: 5000 });
	const state = new Map<string, (typeof events)[number]>();
	for (const e of [...events].reverse()) {
		const key = e.passId ?? `${e.unitId}:${e.visitorName.toLowerCase()}`;
		if (e.kind === 'entry' || e.kind === 'override') state.set(key, e);
		else if (e.kind === 'exit') state.delete(key);
	}
	return [...state.values()].sort((a, b) => b.deviceTs.getTime() - a.deviceTs.getTime());
}

export async function dashboard(estateId: string, timeZone: string) {
	const db = await getDb();
	const startOfDay = localMidnight(timeZone);
	const weekAgo = new Date(Date.now() - 7 * 86_400_000);
	const count = async (...conds: SQL[]) =>
		(await db.select({ n: sql<number>`count(*)::int` }).from(schema.accessEvents).where(and(eq(schema.accessEvents.estateId, estateId), ...conds)))[0].n;

	const [entriesToday, overridesWeek, conflictsWeek, deniedToday] = await Promise.all([
		count(gte(schema.accessEvents.deviceTs, startOfDay), inArray(schema.accessEvents.kind, ['entry', 'override'])),
		count(gte(schema.accessEvents.deviceTs, weekAgo), eq(schema.accessEvents.kind, 'override')),
		count(gte(schema.accessEvents.deviceTs, weekAgo), eq(schema.accessEvents.conflict, true)),
		count(gte(schema.accessEvents.deviceTs, startOfDay), eq(schema.accessEvents.kind, 'deny'))
	]);
	const inside = await insideNow(estateId);
	const devices = await db
		.select({ d: schema.devices, gateName: schema.gates.name })
		.from(schema.devices)
		.innerJoin(schema.gates, eq(schema.gates.id, schema.devices.gateId))
		.where(and(eq(schema.devices.estateId, estateId), isNull(schema.devices.revokedAt)));
	const [{ pendingMembers }] = await db
		.select({ pendingMembers: sql<number>`count(*)::int` })
		.from(schema.memberships)
		.where(and(eq(schema.memberships.estateId, estateId), eq(schema.memberships.status, 'pending')));
	const [{ owing }] = await db
		.select({ owing: sql<number>`count(*)::int` })
		.from(schema.units)
		.where(and(eq(schema.units.estateId, estateId), eq(schema.units.duesStatus, 'owing'), eq(schema.units.active, true)));
	const recentOverrides = await listEvents(estateId, { kind: 'override', from: weekAgo, limit: 5 });
	return {
		entriesToday,
		overridesWeek,
		conflictsWeek,
		deniedToday,
		insideCount: inside.length,
		pendingMembers,
		owing,
		recentOverrides,
		devices: devices.map(({ d, gateName }) => ({
			id: d.id,
			name: d.name,
			gateName,
			enrolled: !!d.enrolledAt,
			lastSyncAt: d.lastSyncAt,
			online: !!d.lastSyncAt && Date.now() - d.lastSyncAt.getTime() < 5 * 60_000
		}))
	};
}

function localMidnight(timeZone: string): Date {
	const now = new Date();
	const { minutes } = localParts(now, timeZone);
	const d = new Date(now.getTime() - minutes * 60_000);
	d.setSeconds(0, 0);
	return d;
}

export async function report(estateId: string, timeZone: string, days = 7) {
	const from = new Date(Date.now() - days * 86_400_000);
	const events = await listEvents(estateId, { from, limit: 5000 });
	const byHour = Array.from({ length: 24 }, () => 0);
	const byDay = new Map<string, number>();
	const byType = new Map<string, number>();
	const overridesByGuard = new Map<string, number>();
	const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
	for (const e of events) {
		if (e.kind === 'entry' || e.kind === 'override') {
			byHour[Math.floor(localParts(e.deviceTs, timeZone).minutes / 60)]++;
			const day = dayFmt.format(e.deviceTs);
			byDay.set(day, (byDay.get(day) ?? 0) + 1);
			const t = e.kind === 'override' ? 'override' : (e.passType ?? 'walk-in');
			byType.set(t, (byType.get(t) ?? 0) + 1);
		}
		if (e.kind === 'override') overridesByGuard.set(e.guardName || 'Unknown', (overridesByGuard.get(e.guardName || 'Unknown') ?? 0) + 1);
	}
	const db = await getDb();
	const decided = await db
		.select({ created: schema.walkinRequests.createdAt, decided: schema.walkinRequests.decidedAt })
		.from(schema.walkinRequests)
		.where(and(eq(schema.walkinRequests.estateId, estateId), gte(schema.walkinRequests.createdAt, from)));
	const times = decided.filter((d) => d.decided).map((d) => (d.decided!.getTime() - d.created.getTime()) / 1000).sort((a, b) => a - b);
	const median = times.length ? times[Math.floor(times.length / 2)] : null;
	const days_: { day: string; count: number }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = dayFmt.format(new Date(Date.now() - i * 86_400_000));
		days_.push({ day, count: byDay.get(day) ?? 0 });
	}
	return {
		byHour,
		byDay: days_,
		byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
		overridesByGuard: [...overridesByGuard.entries()].sort((a, b) => b[1] - a[1]),
		walkins: { total: decided.length, answered: times.length, medianSeconds: median },
		offlineShare: events.length ? events.filter((e) => e.offline).length / events.length : 0
	};
}

// ---------------------------------------------------------------- members

export async function listMembers(estateId: string) {
	const db = await getDb();
	const rows = await db
		.select({ m: schema.memberships, user: schema.users, unit: schema.units })
		.from(schema.memberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
		.leftJoin(schema.units, eq(schema.units.id, schema.memberships.unitId))
		.where(eq(schema.memberships.estateId, estateId));
	return rows.map((r) => ({
		id: r.m.id,
		userId: r.user.id,
		name: r.user.name,
		phone: r.user.phone,
		role: r.m.role,
		status: r.m.status,
		proofNote: r.m.proofNote,
		unitLabel: r.unit ? unitLabel(r.unit) : '',
		unitId: r.m.unitId,
		hasPin: !!r.m.pinHash,
		createdAt: r.m.createdAt
	}));
}

// ---------------------------------------------------------------- bans

export async function listBans(estateId: string) {
	const db = await getDb();
	return db
		.select()
		.from(schema.bans)
		.where(and(eq(schema.bans.estateId, estateId), isNull(schema.bans.removedAt)))
		.orderBy(desc(schema.bans.createdAt));
}

export async function addBan(estateId: string, actorUserId: string, input: { name?: string; phone?: string; reason: string; expiresAt?: Date | null }) {
	const name = input.name?.trim() || null;
	const phone = input.phone?.trim() ? normalisePhone(input.phone) : null;
	if (input.phone?.trim() && !phone) throw new AppError('Phone number looks wrong');
	if (!name && !phone) throw new AppError('Enter a name or a phone number');
	if (!input.reason.trim()) throw new AppError('Give a reason so guards and the RA understand the ban');
	const db = await getDb();
	const [ban] = await db
		.insert(schema.bans)
		.values({ id: randomId(), estateId, name, phone, reason: input.reason.trim(), addedBy: actorUserId, expiresAt: input.expiresAt ?? null })
		.returning();
	await audit(db, { estateId, actorUserId, action: 'ban.add', entity: 'ban', entityId: ban.id, data: { name, phone, reason: ban.reason } });
	return ban;
}

export async function removeBan(estateId: string, actorUserId: string, banId: string) {
	const db = await getDb();
	await db
		.update(schema.bans)
		.set({ removedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.bans.id, banId), eq(schema.bans.estateId, estateId)));
	await audit(db, { estateId, actorUserId, action: 'ban.remove', entity: 'ban', entityId: banId });
}

export async function listAudit(estateId: string, limit = 100) {
	const db = await getDb();
	return db
		.select({ a: schema.auditLogs, actorName: schema.users.name })
		.from(schema.auditLogs)
		.leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
		.where(eq(schema.auditLogs.estateId, estateId))
		.orderBy(desc(schema.auditLogs.createdAt))
		.limit(limit);
}
