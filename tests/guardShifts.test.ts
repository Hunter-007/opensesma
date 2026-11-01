/**
 * A guard can be on duty at only one gate phone at a time.
 * Server rules first, then the real gate engine online and offline.
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

process.env.DATABASE_URL = 'memory://';
process.env.VITEST = 'true';

const estates = await import('../src/lib/server/estates');
const gate = await import('../src/lib/server/gate');
const shifts = await import('../src/lib/server/shifts');
const { listMembers } = await import('../src/lib/server/admin');
const { getDb, schema } = await import('../src/lib/server/db');
const { eq } = await import('drizzle-orm');
const { GateEngine } = await import('../src/lib/client/gate/engine');

let online = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true });

vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
	if (!online) throw new TypeError('Failed to fetch');
	const url = new URL(input, 'http://gate.local');
	const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
	try {
		if (url.pathname === '/api/gate/enroll') return json(await gate.enrollDevice(JSON.parse(String(init.body)).code));
		const device = await gate.authDevice(new Headers(init.headers).get('authorization'));
		const p = url.searchParams;
		if (url.pathname === '/api/gate/sync')
			return json(
				await gate.buildSync(device, {
					since: p.get('since'),
					unitsHash: p.get('u') ?? undefined,
					guardsHash: p.get('g') ?? undefined,
					bansHash: p.get('b') ?? undefined,
					shift: p.get('shift') ? { id: p.get('shift'), guardId: p.get('guard'), startedAt: Number(p.get('shiftStart')) || undefined } : undefined
				})
			);
		if (url.pathname === '/api/gate/events') return json(await gate.ingestEvents(device, JSON.parse(String(init.body)).events, {}));
		if (url.pathname === '/api/gate/shift') {
			const b = JSON.parse(String(init.body));
			if (b.action === 'end') {
				await shifts.endShift(device, b.shiftId);
				return json({ ok: true });
			}
			return json(await shifts.startShift(device, { shiftId: b.shiftId, guardUserId: b.guardId, startedAt: b.startedAt }));
		}
	} catch (e) {
		const err = e as { status?: number; message: string; code?: string };
		return json({ error: err.message, code: err.code }, err.status ?? 500);
	}
	return json({ error: 'not found' }, 404);
});

let estateId: string;
let adminId: string;
let guardId: string; // Sunday
let guard2Id: string; // Musa
let front: { id: string };
let back: { id: string };
let frontDevice: Awaited<ReturnType<typeof gate.authDevice>>;
let backDevice: Awaited<ReturnType<typeof gate.authDevice>>;
let engine: InstanceType<typeof GateEngine>; // the real console, on the front gate

async function phone(gateId: string, name: string) {
	const d = await gate.createDevice(estateId, adminId, gateId, name);
	const { token } = await gate.enrollDevice(d.enrollCode!);
	return { device: await gate.authDevice(`Bearer ${token}`), code: d };
}

beforeAll(async () => {
	await getDb();
	const c = await estates.createEstate({ name: 'Shift Estate', gateNames: ['Front gate', 'Back gate'], admin: { phone: '08060000001', name: 'Manager' } });
	estateId = c.estate.id;
	adminId = c.admin.id;
	[front, back] = c.gates;
	guardId = (await estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08060000002', name: 'Sunday Okon', role: 'guard', pin: '135792' })).id;
	guard2Id = (await estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08060000003', name: 'Musa Bello', role: 'guard', pin: '864201' })).id;
	frontDevice = (await phone(front.id, 'Front phone')).device;
	backDevice = (await phone(back.id, 'Back phone')).device;
	const consoleDevice = await gate.createDevice(estateId, adminId, front.id, 'Front console');
	engine = await new GateEngine().load();
	await engine.enroll(consoleDevice.enrollCode!);
});

describe('server: one gate at a time', () => {
	it('refuses a second shift at another gate, naming where the guard is on duty', async () => {
		const a = await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guardId });
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId })).rejects.toMatchObject({
			status: 409,
			code: 'on_duty_elsewhere',
			message: expect.stringContaining('Sunday Okon is already on duty at Front gate')
		});
		// Same phone, same shift id: resuming is fine (e.g. page reload).
		await expect(shifts.startShift(frontDevice, { shiftId: a.id, guardUserId: guardId })).resolves.toMatchObject({ id: a.id });
		// Another guard can be on duty at the back gate at the same time.
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guard2Id })).resolves.toBeTruthy();
		await shifts.endShift(frontDevice, a.id);
		await shifts.endShiftsForDevices([backDevice.id]);
	});

	it('lets the guard move gates once the first shift has ended', async () => {
		const a = await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guardId });
		await shifts.endShift(frontDevice, a.id);
		const b = await shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId });
		expect(b.gateId).toBe(back.id);
		await shifts.endShift(backDevice, b.id);
	});

	it('the database itself allows only one open shift per guard', async () => {
		const db = await getDb();
		const row = (deviceId: string, gateId: string) => ({ id: uuidv7(), estateId, guardUserId: guardId, deviceId, gateId, startedAt: new Date(), lastSeenAt: new Date() });
		await db.insert(schema.guardShifts).values(row(frontDevice.id, front.id));
		await expect(db.insert(schema.guardShifts).values(row(backDevice.id, back.id))).rejects.toThrow();
		await shifts.endShiftsForDevices([frontDevice.id]);
	});

	it('a new guard on the same phone takes over from the previous one', async () => {
		const a = await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guardId });
		await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guard2Id });
		const db = await getDb();
		const [old] = await db.select().from(schema.guardShifts).where(eq(schema.guardShifts.id, a.id));
		expect(old.endReason).toBe('replaced');
		// Sunday is free to go to the back gate now.
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId })).resolves.toBeTruthy();
		await shifts.endShiftsForDevices([frontDevice.id, backDevice.id]);
	});

	it('the manager can end a stuck shift; the phone is told on its next sync', async () => {
		const a = await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guardId });
		expect((await shifts.openShifts(estateId)).map((s) => s.guardName)).toContain('Sunday Okon');
		await shifts.endShiftAsManager(estateId, adminId, a.id);
		expect(await shifts.checkShift(frontDevice, a.id, guardId)).toMatchObject({ active: false, reason: 'manager' });
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId })).resolves.toBeTruthy();
		await shifts.endShiftsForDevices([backDevice.id]);
	});

	it('a shift whose phone has been silent for 14 hours closes on its own', async () => {
		const a = await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guardId });
		const db = await getDb();
		await db.update(schema.guardShifts).set({ lastSeenAt: new Date(Date.now() - shifts.SHIFT_STALE_MS - 60_000) }).where(eq(schema.guardShifts.id, a.id));
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId })).resolves.toBeTruthy();
		const [old] = await db.select().from(schema.guardShifts).where(eq(schema.guardShifts.id, a.id));
		expect(old.endReason).toBe('expired');
		await shifts.endShiftsForDevices([backDevice.id]);
	});

	it('removing the guard or the gate phone ends the shift', async () => {
		const a = await shifts.startShift(frontDevice, { shiftId: uuidv7(), guardUserId: guard2Id });
		const m = (await listMembers(estateId)).find((x) => x.userId === guard2Id)!;
		await estates.deactivateMember(estateId, adminId, m.id);
		const db = await getDb();
		const [s1] = await db.select().from(schema.guardShifts).where(eq(schema.guardShifts.id, a.id));
		expect(s1.endReason).toBe('removed');

		const extra = await phone(back.id, 'Spare phone');
		const b = await shifts.startShift(extra.device, { shiftId: uuidv7(), guardUserId: guardId });
		await gate.revokeDevice(estateId, adminId, extra.device.id);
		const [s2] = await db.select().from(schema.guardShifts).where(eq(schema.guardShifts.id, b.id));
		expect(s2.endReason).toBe('device_removed');
	});
});

describe('gate phone: online and offline', () => {
	it('online: refuses to start when the guard is on duty at the other gate', async () => {
		const other = await shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId });
		const r = await engine.startShift(guardId, '135792');
		expect(r).toMatchObject({ ok: false, reason: 'on_duty_elsewhere' });
		if (!r.ok) expect(r.error).toContain('already on duty at Back gate');
		expect(engine.guard).toBeNull();
		await shifts.endShift(backDevice, other.id);

		expect(await engine.startShift(guardId, '135792')).toMatchObject({ ok: true, offline: false });
		expect(engine.guard?.shiftId).toBeTruthy();
		// …and now the back gate is refused instead.
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId })).rejects.toMatchObject({ code: 'on_duty_elsewhere' });
	});

	it('a refused hand-over leaves the guard already on duty on this phone', async () => {
		// Sunday is on duty here (from the test above); Ade is on duty at the back gate.
		const sundayShift = engine.guard!.shiftId!;
		const adeId = (await estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08060000009', name: 'Ade Bakare', role: 'guard', pin: '246813' })).id;
		await engine.sync(); // the phone learns Ade's PIN
		const adeBack = await shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: adeId });
		const r = await engine.startShift(adeId, '246813');
		expect(r).toMatchObject({ ok: false, reason: 'on_duty_elsewhere' });
		expect(engine.guard).toMatchObject({ id: guardId, shiftId: sundayShift });
		const [row] = await (await getDb()).select().from(schema.guardShifts).where(eq(schema.guardShifts.id, sundayShift));
		expect(row.endedAt).toBeNull();
		await shifts.endShift(backDevice, adeBack.id);
	});

	it('ending the shift offline frees the guard once the phone reconnects', async () => {
		online = false;
		await engine.endShift();
		expect(engine.guard).toBeNull();
		await expect(shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId })).rejects.toMatchObject({ code: 'on_duty_elsewhere' });
		online = true;
		expect((await engine.sync()).ok).toBe(true);
		const b = await shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId });
		await shifts.endShift(backDevice, b.id);
	});

	it('offline: the shift starts (the gate must keep working) and a clash is settled on the next sync', async () => {
		const other = await shifts.startShift(backDevice, { shiftId: uuidv7(), guardUserId: guardId });
		online = false;
		expect(await engine.startShift(guardId, '135792')).toMatchObject({ ok: true, offline: true });
		online = true;
		expect((await engine.sync()).ok).toBe(true);
		expect(engine.guard).toBeNull();
		expect(engine.shiftNotice).toContain('already on duty at Back gate');
		// The back-gate shift is untouched and the manager has a record.
		expect((await shifts.checkShift(backDevice, other.id, guardId))).toMatchObject({ active: true });
		const db = await getDb();
		const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'shift.conflict'));
		expect(audits.length).toBeGreaterThan(0);
		await shifts.endShift(backDevice, other.id);
	});

	it('offline start with no clash is registered on the next sync and keeps working', async () => {
		online = false;
		expect(await engine.startShift(guardId, '135792')).toMatchObject({ ok: true, offline: true });
		online = true;
		await engine.sync();
		expect(engine.guard?.offline).toBe(false);
		expect((await shifts.openShifts(estateId)).some((s) => s.id === engine.guard!.shiftId)).toBe(true);
	});

	it('a shift ended by the manager signs the guard out on the phone', async () => {
		await shifts.endShiftAsManager(estateId, adminId, engine.guard!.shiftId!);
		await engine.sync();
		expect(engine.guard).toBeNull();
		expect(engine.shiftNotice).toContain('estate manager ended this shift');
	});
});
