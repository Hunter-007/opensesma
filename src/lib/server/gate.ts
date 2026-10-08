import { and, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { randomToken, sha256 } from './crypto';
import { pushToUsers } from './push';
import { sendSms } from './sms';
import { AppError, audit, rateLimit, unitLabel } from './util';
import { config } from './config';
import { createPass, isBanned } from './passes';
import { humanCode, normaliseHumanCode, randomId } from '../shared/encoding';
import { peekPass } from '../shared/passToken';
import { evaluatePass, localDayKey } from '../shared/evaluate';
import { localToUtc } from '../shared/format';
import type { DuesStatus, EventKind, EventMethod, LevyRule, PassType, Role } from '../shared/types';
import { isResidentRole } from '../shared/types';
import { normalisePhone } from '../shared/phone';
import type { SyncPayload } from '../shared/sync';
export type { SyncBan, SyncGuard, SyncPass, SyncPayload, SyncUnit } from '../shared/sync';

const ENROLL_HOURS = 24;

// ---------------------------------------------------------------- devices

export async function createDevice(estateId: string, actorUserId: string, gateId: string, name: string) {
	const db = await getDb();
	const [gate] = await db.select().from(schema.gates).where(and(eq(schema.gates.id, gateId), eq(schema.gates.estateId, estateId)));
	if (!gate) throw new AppError('Choose a gate');
	const [device] = await db
		.insert(schema.devices)
		.values({
			id: randomId(10),
			estateId,
			gateId,
			name: name.trim() || `${gate.name} phone`,
			enrollCode: humanCode(8),
			enrollExpiresAt: new Date(Date.now() + ENROLL_HOURS * 3_600_000),
			createdBy: actorUserId
		})
		.returning();
	await audit(db, { estateId, actorUserId, action: 'device.create', entity: 'device', entityId: device.id });
	return device;
}

export async function regenerateEnrollCode(estateId: string, actorUserId: string, deviceId: string) {
	const db = await getDb();
	const [device] = await db
		.update(schema.devices)
		.set({ enrollCode: humanCode(8), enrollExpiresAt: new Date(Date.now() + ENROLL_HOURS * 3_600_000), tokenHash: null, prevTokenHash: null, tokenIssuedAt: null, enrolledAt: null, revokedAt: null })
		.where(and(eq(schema.devices.id, deviceId), eq(schema.devices.estateId, estateId)))
		.returning();
	if (!device) throw new AppError('Device not found', 404);
	await audit(db, { estateId, actorUserId, action: 'device.reenroll', entity: 'device', entityId: deviceId });
	return device;
}

export async function revokeDevice(estateId: string, actorUserId: string, deviceId: string) {
	const db = await getDb();
	await db
		.update(schema.devices)
		.set({ revokedAt: new Date(), tokenHash: null, prevTokenHash: null, enrollCode: null })
		.where(and(eq(schema.devices.id, deviceId), eq(schema.devices.estateId, estateId)));
	await audit(db, { estateId, actorUserId, action: 'device.revoke', entity: 'device', entityId: deviceId });
}

export async function enrollDevice(rawCode: string) {
	const db = await getDb();
	const code = normaliseHumanCode(rawCode);
	const [device] = await db
		.select()
		.from(schema.devices)
		.where(and(eq(schema.devices.enrollCode, code), gt(schema.devices.enrollExpiresAt, new Date()), isNull(schema.devices.revokedAt)))
		.limit(1);
	if (!device) throw new AppError('That setup code is wrong or expired. Ask the estate manager for a new one.', 400, 'enroll_invalid');
	const token = randomToken();
	await db
		.update(schema.devices)
		.set({ tokenHash: sha256(token), tokenIssuedAt: new Date(), prevTokenHash: null, prevTokenValidUntil: null, enrolledAt: new Date(), enrollCode: null, enrollExpiresAt: null })
		.where(eq(schema.devices.id, device.id));
	await audit(db, { estateId: device.estateId, action: 'device.enroll', entity: 'device', entityId: device.id });
	return { token, deviceId: device.id, estateId: device.estateId, gateId: device.gateId };
}

export type GateDevice = typeof schema.devices.$inferSelect & { presentedPrevious?: boolean };

/** Device tokens rotate on the first sync after this age… */
const TOKEN_ROTATE_MS = 24 * 3_600_000;
/** …the previous token keeps working this long, in case the reply carrying the new one was lost… */
const TOKEN_GRACE_MS = 10 * 60_000;
/** …and a phone that hasn't synced at all for this long must be set up again. */
const TOKEN_MAX_AGE_MS = 30 * 86_400_000;

const removed = () => new AppError('This gate phone was removed. Ask the estate manager to set it up again.', 401, 'device_unauthorized');

export async function authDevice(authHeader: string | null): Promise<GateDevice> {
	const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) throw new AppError('Device not enrolled', 401, 'device_unauthorized');
	const db = await getDb();
	const hash = sha256(token);
	const [current] = await db
		.select()
		.from(schema.devices)
		.where(and(eq(schema.devices.tokenHash, hash), isNull(schema.devices.revokedAt)))
		.limit(1);
	if (current) {
		if (current.tokenIssuedAt && Date.now() - current.tokenIssuedAt.getTime() > TOKEN_MAX_AGE_MS) throw removed();
		return current;
	}
	const [previous] = await db
		.select()
		.from(schema.devices)
		.where(and(eq(schema.devices.prevTokenHash, hash), isNull(schema.devices.revokedAt)))
		.limit(1);
	if (!previous) throw removed();
	if (previous.prevTokenValidUntil && previous.prevTokenValidUntil > new Date()) return { ...previous, presentedPrevious: true };
	// An old token turned up after it was replaced: two copies of this phone's
	// credentials exist. Stop both and tell the estate manager.
	await db.update(schema.devices).set({ revokedAt: new Date(), tokenHash: null, prevTokenHash: null }).where(eq(schema.devices.id, previous.id));
	await audit(db, { estateId: previous.estateId, action: 'device.token_reuse', entity: 'device', entityId: previous.id });
	await notifyAdmins(previous.estateId, {
		title: 'Gate phone blocked',
		body: `“${previous.name}” was used from two places at once, so it has been removed. Set it up again from Admin → Gate phones.`,
		url: '/admin/devices',
		tag: `device-${previous.id}`
	});
	throw removed();
}

/** Issue a fresh device token when the current one is a day old (or a lost reply is being retried). */
async function maybeRotate(device: GateDevice): Promise<string | undefined> {
	const due = device.presentedPrevious || !device.tokenIssuedAt || Date.now() - device.tokenIssuedAt.getTime() > TOKEN_ROTATE_MS;
	if (!due) return undefined;
	const db = await getDb();
	const token = randomToken();
	await db
		.update(schema.devices)
		.set({
			tokenHash: sha256(token),
			tokenIssuedAt: new Date(),
			// Keep accepting the token the phone actually holds for a few minutes.
			prevTokenHash: device.presentedPrevious ? device.prevTokenHash : device.tokenHash,
			prevTokenValidUntil: new Date(Date.now() + TOKEN_GRACE_MS)
		})
		.where(eq(schema.devices.id, device.id));
	return token;
}

// ---------------------------------------------------------------- sync

const OVERLAP_MS = 5_000;

export async function buildSync(
	device: GateDevice,
	opts: { since?: string | null; unitsHash?: string; guardsHash?: string; bansHash?: string }
): Promise<SyncPayload> {
	const db = await getDb();
	const now = new Date();
	const [estate] = await db.select().from(schema.estates).where(eq(schema.estates.id, device.estateId));
	const [gate] = await db.select().from(schema.gates).where(eq(schema.gates.id, device.gateId));

	const since = opts.since ? new Date(new Date(opts.since).getTime() - OVERLAP_MS) : null;
	const passConds = [eq(schema.passes.estateId, estate.id)];
	if (since) passConds.push(gt(schema.passes.updatedAt, since));
	else passConds.push(eq(schema.passes.status, 'active'), or(isNull(schema.passes.validTo), gt(schema.passes.validTo, now))!);
	const passRows = await db.select().from(schema.passes).where(and(...passConds));
	const movement = await passMovement(passRows.map((p) => p.id), estate.timeZone);

	const units = (await db.select().from(schema.units).where(eq(schema.units.estateId, estate.id))).map((u) => ({
		id: u.id,
		label: unitLabel(u),
		active: u.active,
		dues: u.duesStatus
	}));
	units.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
	const guards = (
		await db
			.select({ id: schema.memberships.userId, name: schema.users.name, pinHash: schema.memberships.pinHash })
			.from(schema.memberships)
			.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
			.where(and(eq(schema.memberships.estateId, estate.id), eq(schema.memberships.role, 'guard'), eq(schema.memberships.status, 'active')))
	)
		.filter((g) => g.pinHash)
		.map((g) => ({ id: g.id, name: g.name, pinHash: g.pinHash! }));
	const bans = (
		await db
			.select()
			.from(schema.bans)
			.where(and(eq(schema.bans.estateId, estate.id), isNull(schema.bans.removedAt), or(isNull(schema.bans.expiresAt), gt(schema.bans.expiresAt, now))))
	).map((b) => ({ id: b.id, name: b.name, reason: b.reason }));

	const unitsHash = sha256(JSON.stringify(units)).slice(0, 16);
	const guardsHash = sha256(JSON.stringify(guards)).slice(0, 16);
	const bansHash = sha256(JSON.stringify(bans)).slice(0, 16);

	await db.update(schema.devices).set({ lastSyncAt: now }).where(eq(schema.devices.id, device.id));
	const newToken = await maybeRotate(device);

	return {
		serverTime: now.getTime(),
		cursor: now.toISOString(),
		...(newToken ? { newToken } : {}),
		estate: {
			id: estate.id,
			name: estate.name,
			timeZone: estate.timeZone,
			publicKey: estate.signingPublicKey,
			levyRule: estate.settings.levyRule,
			staleSyncHours: estate.settings.staleSyncHours
		},
		gate: { id: gate.id, name: gate.name },
		device: { id: device.id, name: device.name },
		passes: passRows.flatMap((p) => {
			const claims = peekPass(p.token);
			if (!claims) return [];
			const m = movement.get(p.id);
			return [
				{
					id: p.id,
					code: p.code,
					claims,
					unitId: p.unitId,
					type: p.type,
					name: p.visitorName,
					purpose: p.purpose,
					entriesUsed: p.entriesUsed,
					entriesToday: m?.today ?? 0,
					lastMove: m?.last ?? null,
					maxEntries: p.maxEntries,
					status: p.status,
					validTo: p.validTo ? p.validTo.getTime() : null
				}
			];
		}),
		unitsHash,
		guardsHash,
		bansHash,
		...(opts.unitsHash !== unitsHash ? { units } : {}),
		...(opts.guardsHash !== guardsHash ? { guards } : {}),
		...(opts.bansHash !== bansHash ? { bans } : {})
	};
}

/** Start of "today" in the estate's time zone. */
function localDayStart(now: Date, timeZone: string): Date {
	return localToUtc(localDayKey(now, timeZone), '00:00', timeZone) ?? new Date(now.getTime() - 86_400_000);
}

/** Per pass: entries today across all gates, and whether it was last seen going in or out. */
async function passMovement(passIds: string[], timeZone: string) {
	const out = new Map<string, { today: number; last: 'in' | 'out' | null }>();
	if (!passIds.length) return out;
	const db = await getDb();
	const dayStart = localDayStart(new Date(), timeZone);
	const rows = await db
		.select({ passId: schema.accessEvents.passId, kind: schema.accessEvents.kind, ts: schema.accessEvents.deviceTs })
		.from(schema.accessEvents)
		.where(and(inArray(schema.accessEvents.passId, passIds), gte(schema.accessEvents.deviceTs, new Date(Date.now() - 2 * 86_400_000))))
		.orderBy(schema.accessEvents.deviceTs);
	for (const r of rows) {
		if (!r.passId || r.kind === 'deny') continue;
		const cur = out.get(r.passId) ?? { today: 0, last: null };
		if (r.kind === 'exit') cur.last = 'out';
		else {
			cur.last = 'in';
			if (r.ts >= dayStart) cur.today++;
		}
		out.set(r.passId, cur);
	}
	return out;
}

// ---------------------------------------------------------------- events

export interface IncomingEvent {
	id: string;
	kind: EventKind;
	method: EventMethod;
	passId?: string | null;
	unitId?: string | null;
	passType?: PassType | null;
	visitorName?: string;
	reason?: string;
	guardUserId?: string | null;
	guardName?: string;
	deviceTs: number;
	offline?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: EventKind[] = ['entry', 'exit', 'deny', 'override'];
const METHODS: EventMethod[] = ['qr', 'code', 'walkin', 'override', 'manual'];
const NOTIFY_WINDOW_MS = 30 * 60_000;

/**
 * Idempotent: the device may resend a batch after a dropped connection, so
 * events are keyed by their device-generated UUID and duplicates are ignored.
 */
export async function ingestEvents(device: GateDevice, events: IncomingEvent[], opts: { sentAt?: number } = {}) {
	if (!Array.isArray(events) || events.length > 500) throw new AppError('Send between 1 and 500 events');
	const db = await getDb();
	const accepted: string[] = [];
	const conflicts: string[] = [];
	const flagged: string[] = [];
	// How far the phone's clock is from ours. A phone whose clock was moved can
	// make expired passes look valid; we correct timestamps and flag the entries.
	const skew = Number.isFinite(opts.sentAt) ? Date.now() - (opts.sentAt as number) : 0;
	const skewed = Math.abs(skew) > CLOCK_SKEW_LIMIT_MS;
	const [estateRow] = await db.select({ timeZone: schema.estates.timeZone }).from(schema.estates).where(eq(schema.estates.id, device.estateId));
	let unknownCodes = 0;
	const notify: { unitId: string; kind: EventKind; name: string; method: EventMethod; reason: string; ts: number }[] = [];

	for (const e of events) {
		if (!UUID_RE.test(e.id) || !KINDS.includes(e.kind) || !METHODS.includes(e.method) || !Number.isFinite(e.deviceTs)) continue;
		// Correct for a wrong phone clock, then clamp anything still absurd.
		let ts = skewed ? e.deviceTs + skew : e.deviceTs;
		if (ts > Date.now() + 60_000 || Date.now() - ts > 7 * 86_400_000) ts = Date.now();
		if (e.kind === 'deny' && e.reason === 'unknown_code') unknownCodes++;

		let unitId = e.unitId ?? null;
		let passType = e.passType ?? null;
		if (e.passId) {
			const [p] = await db.select({ unitId: schema.passes.unitId, type: schema.passes.type }).from(schema.passes).where(and(eq(schema.passes.id, e.passId), eq(schema.passes.estateId, device.estateId)));
			if (!p) continue; // pass from another estate or unknown: drop silently
			unitId = p.unitId;
			passType = p.type;
		}
		if (unitId) {
			const [u] = await db.select({ id: schema.units.id }).from(schema.units).where(and(eq(schema.units.id, unitId), eq(schema.units.estateId, device.estateId)));
			if (!u) unitId = null;
		}

		const inserted = await db
			.insert(schema.accessEvents)
			.values({
				id: e.id,
				estateId: device.estateId,
				gateId: device.gateId,
				deviceId: device.id,
				guardUserId: e.guardUserId ?? null,
				guardName: (e.guardName ?? '').slice(0, 60),
				passId: e.passId ?? null,
				unitId,
				passType,
				kind: e.kind,
				method: e.method,
				visitorName: (e.visitorName ?? '').slice(0, 80),
				reason: (e.reason ?? '').slice(0, 200),
				offline: !!e.offline,
				deviceTs: new Date(ts)
			})
			.onConflictDoNothing()
			.returning({ id: schema.accessEvents.id });
		accepted.push(e.id);
		if (!inserted.length) continue; // duplicate resend

		if ((e.kind === 'entry' || e.kind === 'override') && e.passId) {
			const [p] = await db
				.update(schema.passes)
				.set({ entriesUsed: sql`${schema.passes.entriesUsed} + 1`, updatedAt: new Date() })
				.where(eq(schema.passes.id, e.passId))
				.returning({ entriesUsed: schema.passes.entriesUsed, maxEntries: schema.passes.maxEntries });
			if (p && p.maxEntries > 0 && p.entriesUsed > p.maxEntries) {
				await db.update(schema.accessEvents).set({ conflict: true }).where(eq(schema.accessEvents.id, e.id));
				conflicts.push(e.id);
			}
			if (e.kind === 'entry') {
				// Don't take the gate's word for it: re-check the pass as of the
				// (corrected) entry time, so a tampered or stale phone is caught.
				const flag = (await recheckEntry(e.passId, e.id, new Date(ts), estateRow?.timeZone ?? 'Africa/Lagos')) ?? (skewed ? 'clock_skew' : null);
				if (flag) {
					await db.update(schema.accessEvents).set({ flag }).where(eq(schema.accessEvents.id, e.id));
					flagged.push(e.id);
				}
			}
		} else if (e.kind === 'exit' && e.passId) {
			// So other gates learn the visitor has left.
			await db.update(schema.passes).set({ updatedAt: new Date() }).where(eq(schema.passes.id, e.passId));
		}
		if (e.kind === 'override') {
			await audit(db, { estateId: device.estateId, actorUserId: e.guardUserId, action: 'gate.override', entity: 'access_event', entityId: e.id, data: { reason: e.reason, visitor: e.visitorName } });
		}
		if (unitId && e.kind !== 'deny' && Date.now() - ts < NOTIFY_WINDOW_MS) {
			notify.push({ unitId, kind: e.kind, name: e.visitorName ?? '', method: e.method, reason: e.reason ?? '', ts });
		}
		if (e.kind === 'override') {
			await notifyAdmins(device.estateId, {
				title: 'Gate override used',
				body: `${e.guardName || 'A guard'} let in ${e.visitorName || 'a visitor'} without a pass: ${e.reason || 'no reason'}`,
				url: '/admin/log?method=override',
				tag: `override-${e.id}`
			});
		}
	}

	if (flagged.length) {
		await notifyAdmins(device.estateId, {
			title: 'Gate entries need review',
			body: `${flagged.length} entr${flagged.length === 1 ? 'y' : 'ies'} at ${device.name} didn't pass the server's own check (cancelled, expired, outside hours or a wrong phone clock).`,
			url: '/admin/log?flagged=1',
			tag: `flagged-${device.id}`
		});
	}
	// Someone reading out guesses at the gate: tell the manager once per 15 minutes.
	let overThreshold = false;
	for (let i = 0; i < unknownCodes; i++) {
		if (!(await rateLimit(`unknown-codes:${device.id}`, UNKNOWN_CODE_ALERT_AT - 1, 15 * 60))) overThreshold = true;
	}
	if (overThreshold && (await rateLimit(`unknown-codes-alerted:${device.id}`, 1, 15 * 60))) {
		await notifyAdmins(device.estateId, {
			title: 'Many wrong codes at the gate',
			body: `${device.name} has seen ${UNKNOWN_CODE_ALERT_AT}+ unrecognised codes in 15 minutes. Someone may be guessing codes.`,
			url: '/admin/log?kind=deny',
			tag: `guessing-${device.id}`
		});
	}

	// Fire-and-forget style, but awaited so serverless functions don't drop them.
	await Promise.all(notify.map((n) => notifyHousehold(device.estateId, n)));
	return { accepted, conflicts, flagged };
}

const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;
const UNKNOWN_CODE_ALERT_AT = 10;

/**
 * Re-run the gate's decision on the server at the time of entry. Returns a
 * reason when the server disagrees, or null when the entry was legitimate.
 * Entry counts exclude this event itself.
 */
async function recheckEntry(passId: string, eventId: string, at: Date, timeZone: string): Promise<string | null> {
	const db = await getDb();
	const [p] = await db.select().from(schema.passes).where(eq(schema.passes.id, passId));
	if (!p) return 'unknown_pass';
	const claims = peekPass(p.token);
	if (!claims) return 'bad_signature';
	const prior = await db
		.select({ kind: schema.accessEvents.kind, ts: schema.accessEvents.deviceTs, id: schema.accessEvents.id })
		.from(schema.accessEvents)
		.where(and(eq(schema.accessEvents.passId, passId), lt(schema.accessEvents.deviceTs, at)));
	const entries = prior.filter((r) => r.id !== eventId && (r.kind === 'entry' || r.kind === 'override'));
	const dayStart = localDayStart(at, timeZone);
	const [unit] = await db.select({ active: schema.units.active }).from(schema.units).where(eq(schema.units.id, p.unitId));
	const decision = evaluatePass(claims, {
		now: at,
		estateId: p.estateId,
		timeZone,
		entriesUsed: entries.length,
		entriesToday: entries.filter((r) => r.ts >= dayStart).length,
		// Cancelled before this entry happened? (Cancelling afterwards is fine.)
		revoked: p.status === 'revoked' && !!p.revokedAt && p.revokedAt <= at,
		unitActive: unit?.active ?? false
	});
	// Over-capacity is already reported as a double entry.
	if (decision.allow || decision.reason === 'used_up') return null;
	return decision.reason;
}

async function householdUserIds(unitId: string) {
	const db = await getDb();
	const rows = await db
		.select({ userId: schema.memberships.userId, phone: schema.users.phone, role: schema.memberships.role })
		.from(schema.memberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
		.where(and(eq(schema.memberships.unitId, unitId), eq(schema.memberships.status, 'active')));
	return rows.filter((r) => isResidentRole(r.role as Role));
}

async function notifyHousehold(estateId: string, n: { unitId: string; kind: EventKind; name: string; method: EventMethod; reason: string }) {
	const members = await householdUserIds(n.unitId);
	const who = n.name || 'Your visitor';
	const title = n.kind === 'exit' ? `${who} has left` : n.kind === 'override' ? `${who} was let in by the guard` : `${who} has arrived`;
	const body =
		n.kind === 'override'
			? `Entered without a pass. Reason given: ${n.reason || 'none'}`
			: n.kind === 'exit'
				? 'Checked out at the gate.'
				: 'Checked in at the gate.';
	await pushToUsers(members.map((m) => m.userId), { title, body, url: '/app/history', tag: `visit-${n.unitId}` });
}

async function notifyAdmins(estateId: string, payload: { title: string; body: string; url: string; tag: string }) {
	const db = await getDb();
	const admins = await db
		.select({ userId: schema.memberships.userId })
		.from(schema.memberships)
		.where(and(eq(schema.memberships.estateId, estateId), eq(schema.memberships.status, 'active'), inArray(schema.memberships.role, ['estate_admin', 'security_officer'])));
	await pushToUsers(admins.map((a) => a.userId), payload);
}

// ---------------------------------------------------------------- walk-ins (PRD 4)

const SMS_FALLBACK_MS = 45_000;
const WALKIN_TIMEOUT_MS = 3 * 60_000;
const WALKIN_EXPIRE_MS = 15 * 60_000;

export async function createWalkin(
	device: GateDevice,
	input: { unitId: string; visitorName: string; visitorPhone?: string; purpose?: string; guardName?: string }
) {
	const db = await getDb();
	const name = input.visitorName?.trim();
	if (!name) throw new AppError("Enter the visitor's name");
	const [unit] = await db.select().from(schema.units).where(and(eq(schema.units.id, input.unitId), eq(schema.units.estateId, device.estateId)));
	if (!unit) throw new AppError('Choose the house they are visiting');
	if (!unit.active) throw new AppError('That house is not active on the estate');
	const phone = input.visitorPhone ? normalisePhone(input.visitorPhone) : null;
	if (await isBanned(device.estateId, { name, phone }))
		throw new AppError('This visitor is on the estate ban list. Refer to your supervisor.', 403, 'banned');

	const [w] = await db
		.insert(schema.walkinRequests)
		.values({
			id: randomId(),
			estateId: device.estateId,
			unitId: unit.id,
			gateId: device.gateId,
			deviceId: device.id,
			guardName: input.guardName?.slice(0, 60) ?? '',
			visitorName: name.slice(0, 80),
			visitorPhone: phone,
			purpose: (input.purpose ?? '').slice(0, 80),
			replyToken: randomToken(12)
		})
		.returning();

	const members = await householdUserIds(unit.id);
	const [gate] = await db.select().from(schema.gates).where(eq(schema.gates.id, device.gateId));
	const delivered = await pushToUsers(
		members.map((m) => m.userId),
		{
			title: `${w.visitorName} is at the gate`,
			body: `${w.purpose ? w.purpose + ' · ' : ''}${gate?.name ?? 'Gate'} · for ${unitLabel(unit)}. Let them in?`,
			url: `/app/walkin/${w.id}`,
			tag: `walkin-${w.id}`,
			requireInteraction: true,
			actions: [
				{ action: 'approve', title: 'Let in' },
				{ action: 'deny', title: 'Decline' }
			],
			data: { walkinId: w.id }
		}
	);
	// Nobody has push on: go straight to SMS rather than waiting 45 s.
	if (delivered === 0) await sendWalkinSms(w, unitLabel(unit));
	return { ...w, unitLabel: unitLabel(unit) };
}

async function sendWalkinSms(w: typeof schema.walkinRequests.$inferSelect, label: string) {
	const db = await getDb();
	const [claimed] = await db
		.update(schema.walkinRequests)
		.set({ smsFallbackAt: new Date() })
		.where(and(eq(schema.walkinRequests.id, w.id), isNull(schema.walkinRequests.smsFallbackAt)))
		.returning();
	if (!claimed) return; // another poll already sent it
	const members = await householdUserIds(w.unitId);
	const link = `${config.publicUrl}/w/${w.replyToken}`;
	await Promise.all(
		members.map((m) =>
			sendSms(m.phone, `${w.visitorName}${w.purpose ? ` (${w.purpose})` : ''} is at the gate for ${label}. Let in or decline: ${link}`)
		)
	);
}

/** Guard device polls this. It also lazily triggers the SMS fallback and expiry, so no cron is needed. */
export async function pollWalkin(device: GateDevice, id: string) {
	const db = await getDb();
	const [w] = await db
		.select()
		.from(schema.walkinRequests)
		.where(and(eq(schema.walkinRequests.id, id), eq(schema.walkinRequests.estateId, device.estateId)));
	if (!w) throw new AppError('Request not found', 404);
	const age = Date.now() - w.createdAt.getTime();
	if (w.status === 'pending' && age > WALKIN_EXPIRE_MS) {
		await db.update(schema.walkinRequests).set({ status: 'expired' }).where(eq(schema.walkinRequests.id, w.id));
		w.status = 'expired';
	} else if (w.status === 'pending' && age > SMS_FALLBACK_MS && !w.smsFallbackAt) {
		const [unit] = await db.select().from(schema.units).where(eq(schema.units.id, w.unitId));
		await sendWalkinSms(w, unitLabel(unit));
	}
	let pass: { id: string; token: string; code: string } | null = null;
	if (w.status === 'approved' && w.passId) {
		const [p] = await db.select({ id: schema.passes.id, token: schema.passes.token, code: schema.passes.code }).from(schema.passes).where(eq(schema.passes.id, w.passId));
		pass = p ?? null;
	}
	const phones = w.status === 'pending' && age > WALKIN_TIMEOUT_MS ? (await householdUserIds(w.unitId)).map((m) => m.phone) : [];
	return {
		id: w.id,
		status: w.status,
		decidedByName: w.decidedByName,
		note: w.note,
		smsSent: !!w.smsFallbackAt,
		timedOut: w.status === 'pending' && age > WALKIN_TIMEOUT_MS,
		callNumbers: phones,
		pass
	};
}

export async function getWalkinForUser(walkinId: string, userId: string) {
	const db = await getDb();
	const [row] = await db
		.select({ w: schema.walkinRequests, unit: schema.units, gate: schema.gates })
		.from(schema.walkinRequests)
		.innerJoin(schema.units, eq(schema.units.id, schema.walkinRequests.unitId))
		.innerJoin(schema.gates, eq(schema.gates.id, schema.walkinRequests.gateId))
		.innerJoin(
			schema.memberships,
			and(eq(schema.memberships.unitId, schema.walkinRequests.unitId), eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active'))
		)
		.where(eq(schema.walkinRequests.id, walkinId));
	if (!row) throw new AppError('Request not found', 404);
	return row;
}

export async function getWalkinByReplyToken(token: string) {
	const db = await getDb();
	const [row] = await db
		.select({ w: schema.walkinRequests, unit: schema.units, gate: schema.gates })
		.from(schema.walkinRequests)
		.innerJoin(schema.units, eq(schema.units.id, schema.walkinRequests.unitId))
		.innerJoin(schema.gates, eq(schema.gates.id, schema.walkinRequests.gateId))
		.where(eq(schema.walkinRequests.replyToken, token));
	return row ?? null;
}

/**
 * First household member to answer wins; later answers see who decided.
 * `by.userId` is null when the decision came from the SMS link.
 */
export async function decideWalkin(walkinId: string, approve: boolean, by: { userId: string | null; name: string }, note = '') {
	const db = await getDb();
	const [w] = await db.select().from(schema.walkinRequests).where(eq(schema.walkinRequests.id, walkinId));
	if (!w) throw new AppError('Request not found', 404);
	if (w.status !== 'pending') return { alreadyDecided: true as const, walkin: w };
	if (Date.now() - w.createdAt.getTime() > WALKIN_EXPIRE_MS) throw new AppError('This request has expired', 410, 'expired');

	const [claimed] = await db
		.update(schema.walkinRequests)
		.set({ status: approve ? 'approved' : 'denied', decidedBy: by.userId, decidedByName: by.name, decidedAt: new Date(), note: note.slice(0, 120) })
		.where(and(eq(schema.walkinRequests.id, walkinId), eq(schema.walkinRequests.status, 'pending')))
		.returning();
	if (!claimed) {
		const [now] = await db.select().from(schema.walkinRequests).where(eq(schema.walkinRequests.id, walkinId));
		return { alreadyDecided: true as const, walkin: now };
	}

	if (approve) {
		let creatorId = by.userId;
		if (!creatorId) creatorId = (await householdUserIds(w.unitId))[0]?.userId ?? 'sms-link';
		const pass = await createPass(
			{ userId: creatorId, estateId: w.estateId, unitId: w.unitId },
			{ type: 'guest', visitorName: w.visitorName, visitorPhone: w.visitorPhone ?? undefined, validTo: new Date(Date.now() + 2 * 3_600_000) }
		);
		await db.update(schema.walkinRequests).set({ passId: pass.id }).where(eq(schema.walkinRequests.id, walkinId));
		claimed.passId = pass.id;
	}
	await audit(db, { estateId: w.estateId, actorUserId: by.userId, action: approve ? 'walkin.approve' : 'walkin.deny', entity: 'walkin', entityId: walkinId });
	return { alreadyDecided: false as const, walkin: claimed };
}

export async function pendingWalkinsForUser(userId: string) {
	const db = await getDb();
	return db
		.select({ w: schema.walkinRequests, gateName: schema.gates.name })
		.from(schema.walkinRequests)
		.innerJoin(schema.gates, eq(schema.gates.id, schema.walkinRequests.gateId))
		.innerJoin(
			schema.memberships,
			and(eq(schema.memberships.unitId, schema.walkinRequests.unitId), eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active'))
		)
		.where(and(eq(schema.walkinRequests.status, 'pending'), gte(schema.walkinRequests.createdAt, new Date(Date.now() - WALKIN_EXPIRE_MS))));
}

// ---------------------------------------------------------------- maintenance

/** NDPA retention: strip visitor personal data from old records. Safe to run daily. */
export async function runRetention() {
	const db = await getDb();
	const estates = await db.select({ id: schema.estates.id, settings: schema.estates.settings }).from(schema.estates);
	let anonymised = 0;
	for (const e of estates) {
		const cutoff = new Date();
		cutoff.setMonth(cutoff.getMonth() - (e.settings.retentionMonths || 12));
		const ev = await db
			.update(schema.accessEvents)
			.set({ visitorName: '[removed]' })
			.where(and(eq(schema.accessEvents.estateId, e.id), lt(schema.accessEvents.deviceTs, cutoff), sql`${schema.accessEvents.visitorName} <> '[removed]'`))
			.returning({ id: schema.accessEvents.id });
		await db
			.update(schema.passes)
			.set({ visitorName: '[removed]', visitorPhone: null })
			.where(and(eq(schema.passes.estateId, e.id), lt(schema.passes.createdAt, cutoff), sql`${schema.passes.visitorName} <> '[removed]'`));
		await db
			.update(schema.walkinRequests)
			.set({ visitorName: '[removed]', visitorPhone: null })
			.where(and(eq(schema.walkinRequests.estateId, e.id), lt(schema.walkinRequests.createdAt, cutoff)));
		anonymised += ev.length;
	}
	// Housekeeping
	await db.delete(schema.otps).where(lt(schema.otps.expiresAt, new Date(Date.now() - 86_400_000)));
	await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
	await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 86_400_000)));
	return { anonymised };
}
