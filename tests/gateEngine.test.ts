/**
 * The guard console engine against the REAL server sync/ingest code, with the
 * network switched on and off. Proves the gate keeps working offline and
 * catches up correctly afterwards.
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL = 'memory://';
process.env.VITEST = 'true';

const estates = await import('../src/lib/server/estates');
const passes = await import('../src/lib/server/passes');
const gate = await import('../src/lib/server/gate');
const { getDb } = await import('../src/lib/server/db');
const { GateEngine } = await import('../src/lib/client/gate/engine');

let online = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true });

// Route the engine's fetch calls straight into the server modules.
vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
	if (!online) throw new TypeError('Failed to fetch');
	const url = new URL(input, 'http://gate.local');
	const headers = new Headers(init.headers);
	const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
	try {
		if (url.pathname === '/api/gate/enroll') return json(await gate.enrollDevice(JSON.parse(String(init.body)).code));
		const device = await gate.authDevice(headers.get('authorization'));
		if (url.pathname === '/api/gate/sync')
			return json(
				await gate.buildSync(device, {
					since: url.searchParams.get('since'),
					unitsHash: url.searchParams.get('u') ?? undefined,
					guardsHash: url.searchParams.get('g') ?? undefined,
					bansHash: url.searchParams.get('b') ?? undefined
				})
			);
		if (url.pathname === '/api/gate/events') return json(await gate.ingestEvents(device, JSON.parse(String(init.body)).events));
	} catch (e) {
		const err = e as { status?: number; message: string };
		return json({ error: err.message }, err.status ?? 500);
	}
	return json({ error: 'not found' }, 404);
});

let estateId: string;
let adminId: string;
let actor: { userId: string; estateId: string; unitId: string };
let engine: InstanceType<typeof GateEngine>;

beforeAll(async () => {
	await getDb();
	const c = await estates.createEstate({ name: 'Test Estate', gateNames: ['Main'], admin: { phone: '08020000001', name: 'Admin' } });
	estateId = c.estate.id;
	adminId = c.admin.id;
	const unit = await estates.addUnit(estateId, 'Palm Avenue', '3');
	const resident = await estates.upsertUser('+2348020000002', 'Resident');
	actor = { userId: resident.id, estateId, unitId: unit.id };
	await estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08020000003', name: 'Garba', role: 'guard', pin: '2468' });
	const dev = await gate.createDevice(estateId, adminId, c.gates[0].id, 'Main phone');
	engine = await new GateEngine().load();
	await engine.enroll(dev.enrollCode!);
});

describe('guard console engine', () => {
	it('enrols, downloads guards, and verifies a PIN offline', async () => {
		expect(engine.ready).toBe(true);
		online = false;
		expect(await engine.startShift(engine.guards[0].id, '0000')).toBe(false);
		expect(await engine.startShift(engine.guards[0].id, '2468')).toBe(true);
		online = true;
	});

	it('verifies codes and QR passes with the network off, then uploads on reconnect', async () => {
		const p = await passes.createPass(actor, { type: 'guest', visitorName: 'Ngozi' });
		const scanned = await passes.createPass(actor, { type: 'guest', visitorName: 'Created after last sync' });
		await engine.sync();
		// A pass created AFTER the last sync still verifies by QR: the token is self-proving.
		const late = await passes.createPass(actor, { type: 'guest', visitorName: 'Very late guest' });

		online = false;
		const byCode = await engine.checkCode(p.code);
		expect(byCode.allow).toBe(true);
		await engine.checkIn(byCode);
		expect((await engine.checkCode(p.code)).reason).toBe('used_up'); // local count blocks reuse

		const byQr = await engine.checkScan(`https://opensesma.app/p/${late.token}`);
		expect(byQr.allow).toBe(true);
		expect(byQr.claims?.name).toBe('Very late guest');
		await engine.checkIn(byQr);
		expect((await engine.checkScan(late.token)).reason).toBe('used_up');

		expect(await engine.pendingCount()).toBe(2);
		expect((await engine.insideNow()).length).toBe(2);
		expect(scanned.code).toBeTruthy();

		online = true;
		const r = await engine.sync();
		expect(r.ok).toBe(true);
		expect(await engine.pendingCount()).toBe(0);
		const { listEvents } = await import('../src/lib/server/admin');
		const log = await listEvents(estateId, {});
		expect(log.filter((e) => e.offline && e.kind === 'entry')).toHaveLength(2);
	});

	it('shows "cancelled" for a revoked code, not "unknown"', async () => {
		const p = await passes.createPass(actor, { type: 'delivery' });
		await engine.sync();
		await passes.revokePass(estateId, actor.userId, p.id);
		await engine.sync();
		const r = await engine.checkCode(p.code);
		expect(r.allow).toBe(false);
		expect(r.reason).toBe('revoked');
	});

	it('locks the keypad after 5 wrong codes, and the lock survives a reload', async () => {
		for (let i = 0; i < 5; i++) expect((await engine.checkCode('100000')).reason).toBe('unknown_code');
		expect((await engine.checkCode('100001')).reason).toBe('locked');
		const reloaded = await new GateEngine().load();
		expect((await reloaded.checkCode('100002')).reason).toBe('locked');
	});

	it('wipes itself when the estate manager removes the phone', async () => {
		await gate.revokeDevice(estateId, adminId, engine.config!.deviceId);
		const r = await engine.sync();
		expect(r).toEqual({ ok: false, error: 'device_removed' });
		expect(engine.enrolled).toBe(false);
		expect((await new GateEngine().load()).enrolled).toBe(false);
	});
});
