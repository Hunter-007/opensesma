/**
 * Guard shifts: one guard can be on duty at only one gate phone at a time.
 *
 * - Online (the normal case) the gate phone asks before starting a shift and
 *   is refused if the guard is already on duty elsewhere.
 * - Offline the gate keeps working: the phone starts the shift locally and
 *   reports it on its next sync. If it clashes, that later shift is ended on
 *   the phone and the estate manager is alerted.
 * - The database allows only one open shift per guard (partial unique index),
 *   so two phones racing can't both win.
 */
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { GateDevice } from './gate';
import { AppError, audit } from './util';
import { formatTime } from '../shared/format';

/** A shift with no contact from its phone for this long is closed automatically. */
export const SHIFT_STALE_MS = 14 * 3_600_000;

const SHIFT_ID = /^[0-9a-f-]{36}$/i;

export type ShiftState = { active: true } | { active: false; reason: string; message: string };

async function guardOf(device: GateDevice, guardUserId: string) {
	const db = await getDb();
	const [g] = await db
		.select({ name: schema.users.name })
		.from(schema.memberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
		.where(
			and(
				eq(schema.memberships.userId, guardUserId),
				eq(schema.memberships.estateId, device.estateId),
				eq(schema.memberships.role, 'guard'),
				eq(schema.memberships.status, 'active')
			)
		);
	if (!g) throw new AppError('This guard is not on the estate’s guard list', 404, 'not_guard');
	return g;
}

/** Close shifts whose phone has gone quiet for too long, so nobody is locked out forever. */
async function closeStale(estateId: string, now = new Date()) {
	const db = await getDb();
	await db
		.update(schema.guardShifts)
		.set({ endedAt: now, endReason: 'expired' })
		.where(and(eq(schema.guardShifts.estateId, estateId), isNull(schema.guardShifts.endedAt), lt(schema.guardShifts.lastSeenAt, new Date(now.getTime() - SHIFT_STALE_MS))));
}

async function openShiftFor(guardUserId: string) {
	const db = await getDb();
	const [row] = await db
		.select({ shift: schema.guardShifts, gateName: schema.gates.name })
		.from(schema.guardShifts)
		.innerJoin(schema.gates, eq(schema.gates.id, schema.guardShifts.gateId))
		.where(and(eq(schema.guardShifts.guardUserId, guardUserId), isNull(schema.guardShifts.endedAt)));
	return row ?? null;
}

function elsewhereMessage(name: string, gateName: string, since: Date, timeZone: string) {
	return `${name || 'This guard'} is already on duty at ${gateName} (since ${formatTime(since, timeZone)}). End that shift on that phone first, or ask the estate manager to end it.`;
}

async function estateTz(estateId: string) {
	const db = await getDb();
	const [e] = await db.select({ tz: schema.estates.timeZone }).from(schema.estates).where(eq(schema.estates.id, estateId));
	return e?.tz ?? 'Africa/Lagos';
}

const isUniqueViolation = (e: unknown) => {
	const err = e as { code?: string; cause?: { code?: string }; message?: string };
	return err?.code === '23505' || err?.cause?.code === '23505' || /unique|duplicate key/i.test(err?.message ?? '');
};

/**
 * Starts (or resumes) a shift on this gate phone. Throws 409 `on_duty_elsewhere`
 * if the guard is on duty at another phone.
 */
export async function startShift(device: GateDevice, input: { shiftId: string; guardUserId: string; startedAt?: number; offline?: boolean }) {
	if (!SHIFT_ID.test(input.shiftId)) throw new AppError('Bad shift id', 400, 'bad_request');
	const guard = await guardOf(device, input.guardUserId);
	const db = await getDb();
	const now = new Date();
	await closeStale(device.estateId, now);

	const [existing] = await db.select().from(schema.guardShifts).where(eq(schema.guardShifts.id, input.shiftId));
	if (existing) {
		if (existing.deviceId !== device.id || existing.guardUserId !== input.guardUserId) throw new AppError('Bad shift id', 400, 'bad_request');
		if (existing.endedAt) throw new AppError('This shift has ended. Start a new one.', 409, existing.endReason ?? 'ended');
		return existing;
	}

	const open = await openShiftFor(input.guardUserId);
	if (open && open.shift.deviceId !== device.id)
		throw new AppError(elsewhereMessage(guard.name, open.gateName, open.shift.startedAt, await estateTz(device.estateId)), 409, 'on_duty_elsewhere');

	// Never trust a phone's clock for more than a day back, or for the future.
	const claimed = input.startedAt ? new Date(input.startedAt) : now;
	const startedAt = claimed > now || now.getTime() - claimed.getTime() > 86_400_000 ? now : claimed;
	let shift: typeof schema.guardShifts.$inferSelect;
	try {
		// One transaction, so a refused start never ends the shift of whoever is on
		// duty on this phone. (The unique-violation catch is outside on purpose: a
		// failed statement aborts the transaction in Postgres.)
		shift = await db.transaction(async (tx) => {
			// One guard at a time per phone: whoever was on duty here hands over.
			await tx
				.update(schema.guardShifts)
				.set({ endedAt: now, endReason: 'replaced' })
				.where(and(eq(schema.guardShifts.deviceId, device.id), isNull(schema.guardShifts.endedAt)));
			const [row] = await tx
				.insert(schema.guardShifts)
				.values({
					id: input.shiftId,
					estateId: device.estateId,
					guardUserId: input.guardUserId,
					deviceId: device.id,
					gateId: device.gateId,
					startedAt,
					lastSeenAt: now,
					startedOffline: !!input.offline
				})
				.returning();
			return row;
		});
	} catch (e) {
		if (!isUniqueViolation(e)) throw e;
		// Another phone won the race a moment ago.
		const winner = await openShiftFor(input.guardUserId);
		throw new AppError(
			winner ? elsewhereMessage(guard.name, winner.gateName, winner.shift.startedAt, await estateTz(device.estateId)) : 'This guard is already on duty elsewhere.',
			409,
			'on_duty_elsewhere'
		);
	}
	await audit(db, { estateId: device.estateId, action: 'shift.start', entity: 'user', entityId: input.guardUserId, data: { deviceId: device.id, gateId: device.gateId, offline: !!input.offline } });
	return shift;
}

export async function endShift(device: GateDevice, shiftId: string) {
	if (!SHIFT_ID.test(shiftId)) return;
	const db = await getDb();
	await db
		.update(schema.guardShifts)
		.set({ endedAt: new Date(), endReason: 'ended' })
		.where(and(eq(schema.guardShifts.id, shiftId), eq(schema.guardShifts.deviceId, device.id), isNull(schema.guardShifts.endedAt)));
}

/**
 * Called on every sync with the shift the phone thinks is running. Keeps it
 * alive, registers shifts started offline, and tells the phone to end a shift
 * that clashes or that the manager ended.
 */
export async function checkShift(device: GateDevice, shiftId: string | null, guardUserId: string | null, startedAt?: number): Promise<ShiftState | undefined> {
	if (!shiftId || !guardUserId) return undefined;
	const db = await getDb();
	const [existing] = await db.select().from(schema.guardShifts).where(eq(schema.guardShifts.id, shiftId));
	if (existing && existing.deviceId === device.id) {
		if (existing.endedAt) return ended(existing.endReason ?? 'ended');
		await db.update(schema.guardShifts).set({ lastSeenAt: new Date() }).where(eq(schema.guardShifts.id, shiftId));
		return { active: true };
	}
	try {
		await startShift(device, { shiftId, guardUserId, startedAt, offline: true });
		return { active: true };
	} catch (e) {
		if (!(e instanceof AppError)) throw e;
		if (e.code === 'on_duty_elsewhere') {
			const [gate] = await db.select({ name: schema.gates.name }).from(schema.gates).where(eq(schema.gates.id, device.gateId));
			const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, guardUserId));
			await audit(db, { estateId: device.estateId, action: 'shift.conflict', entity: 'user', entityId: guardUserId, data: { deviceId: device.id } });
			const { notifyAdmins } = await import('./gate');
			await notifyAdmins(device.estateId, {
				title: 'Guard on duty at two gates',
				body: `${user?.name || 'A guard'} started a shift at ${gate?.name ?? 'a gate'} while offline, but was already on duty at another gate. That second shift has been ended. Check the gate log.`,
				url: '/admin/devices',
				tag: `shift-conflict-${guardUserId}`
			});
			return { active: false, reason: 'on_duty_elsewhere', message: e.message };
		}
		if (e.code === 'not_guard') return ended('removed');
		return ended(e.code ?? 'ended');
	}
}

function ended(reason: string): ShiftState {
	const messages: Record<string, string> = {
		manager: 'The estate manager ended this shift. Start a new one with your PIN.',
		expired: 'This shift ended because the phone was out of contact for too long. Start a new one with your PIN.',
		replaced: 'Another guard started a shift on this phone.',
		removed: 'This guard was removed from the estate.',
		on_duty_elsewhere: 'This guard is on duty at another gate.'
	};
	return { active: false, reason, message: messages[reason] ?? 'This shift has ended. Start a new one with your PIN.' };
}

/** Who is on duty where, for the manager's Gate phones page. */
export async function openShifts(estateId: string) {
	const db = await getDb();
	await closeStale(estateId);
	return db
		.select({ id: schema.guardShifts.id, deviceId: schema.guardShifts.deviceId, gateId: schema.guardShifts.gateId, startedAt: schema.guardShifts.startedAt, lastSeenAt: schema.guardShifts.lastSeenAt, guardName: schema.users.name })
		.from(schema.guardShifts)
		.innerJoin(schema.users, eq(schema.users.id, schema.guardShifts.guardUserId))
		.where(and(eq(schema.guardShifts.estateId, estateId), isNull(schema.guardShifts.endedAt)));
}

export async function endShiftAsManager(estateId: string, actorUserId: string, shiftId: string) {
	const db = await getDb();
	const [s] = await db
		.update(schema.guardShifts)
		.set({ endedAt: new Date(), endReason: 'manager' })
		.where(and(eq(schema.guardShifts.id, shiftId), eq(schema.guardShifts.estateId, estateId), isNull(schema.guardShifts.endedAt)))
		.returning();
	if (!s) throw new AppError('That shift has already ended', 404, 'not_found');
	await audit(db, { estateId, actorUserId, action: 'shift.end_by_manager', entity: 'user', entityId: s.guardUserId, data: { shiftId } });
	return s;
}

/** End every open shift on these devices (phone removed or replaced). */
export async function endShiftsForDevices(deviceIds: string[], reason = 'device_removed') {
	if (!deviceIds.length) return;
	const db = await getDb();
	await db.update(schema.guardShifts).set({ endedAt: new Date(), endReason: reason }).where(and(inArray(schema.guardShifts.deviceId, deviceIds), isNull(schema.guardShifts.endedAt)));
}

/** End a guard's open shift when they are removed from the estate. */
export async function endShiftsForGuard(estateId: string, guardUserId: string, reason = 'removed') {
	const db = await getDb();
	await db
		.update(schema.guardShifts)
		.set({ endedAt: new Date(), endReason: reason })
		.where(and(eq(schema.guardShifts.estateId, estateId), eq(schema.guardShifts.guardUserId, guardUserId), isNull(schema.guardShifts.endedAt)));
}
