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
		if (url.pathname === '/api/gate/events') {
			const body = JSON.parse(String(init.body));
			return json(await gate.ingestEvents(device, body.events, { sentAt: body.sentAt }));
		}
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
	await estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08020000003', name: 'Garba', role: 'guard', pin: '246813' });
	const dev = await gate.createDevice(estateId, adminId, c.gates[0].id, 'Main phone');
	engine = await new GateEngine().load();
	await engine.enroll(dev.enrollCode!);
});

describe('guard console engine', () => {
	it('enrols, downloads guards, and verifies a PIN offline', async () => {
		expect(engine.ready).toBe(true);
		online = false;
		expect(await engine.startShift(engine.guards[0].id, '000000')).toBe(false);
		expect(await engine.startShift(engine.guards[0].id, '246813')).toBe(true);
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

	// The lockout test above leaves the keypad locked (by design, it survives reloads).
	const resetLocks = async () => {
		online = true;
		const store = await import('../src/lib/client/gate/store');
		await store.kv.set('codeFailures', []);
		await store.kv.set('pinFailures', []);
		await engine.load();
	};

	it('F2: enforces the daily cap offline, across reloads', async () => {
		await resetLocks();
		const p = await passes.createPass(actor, { type: 'artisan', visitorName: 'Daily Cap', purpose: 'Tiling' });
		await engine.sync();
		online = false;
		for (let i = 0; i < 4; i++) {
			const r = await engine.checkCode(p.code);
			expect(r.allow).toBe(true);
			await engine.checkIn(r);
			await engine.record({ kind: 'exit', method: 'manual', passId: p.id, unitId: actor.unitId, visitorName: 'Daily Cap' });
		}
		const fifth = await engine.checkCode(p.code);
		expect(fifth.allow).toBe(false);
		expect(fifth.reason).toBe('daily_limit');
		const reloaded = await new GateEngine().load();
		expect((await reloaded.checkCode(p.code)).reason).toBe('daily_limit');
		online = true;
		await engine.sync();
	});

	it('F2: warns when a personal pass is used again without checking out', async () => {
		await resetLocks();
		const p = await passes.createPass(actor, { type: 'multiday', visitorName: 'Shared Code', validTo: new Date(Date.now() + 2 * 86_400_000) });
		await engine.sync();
		const first = await engine.checkCode(p.code);
		await engine.checkIn(first);
		const second = await engine.checkCode(p.code);
		expect(second.allow).toBe(true);
		expect(second.warnings.join(' ')).toMatch(/already inside/);
	});

	it('F3: stores the rotated device token from the server', async () => {
		await resetLocks();
		const db = await getDb();
		const { schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		const before = engine.config!.token;
		await db.update(schema.devices).set({ tokenIssuedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.devices.id, engine.config!.deviceId));
		expect((await engine.sync()).ok).toBe(true);
		expect(engine.config!.token).not.toBe(before);
		expect((await new GateEngine().load()).config!.token).toBe(engine.config!.token);
		expect((await engine.sync()).ok).toBe(true);
	});

	it('F6: judges passes by server time, not a tampered phone clock', async () => {
		await resetLocks();
		const p = await passes.createPass(actor, { type: 'delivery' });
		await engine.sync();
		const realNow = Date.now;
		// Someone moves the phone's date back a day after the last sync.
		Date.now = () => realNow() - 86_400_000;
		try {
			const r = await engine.checkCode(p.code);
			// Server-anchored time says the pass is valid now; the wrong clock is ignored.
			expect(r.allow).toBe(true);
			expect(Math.abs(engine.now() - realNow())).toBeLessThan(60_000);
		} finally {
			Date.now = realNow;
		}
	});

	it('F16: locks shift sign-in after repeated wrong PINs, even after a reload', async () => {
		await resetLocks();
		const g = engine.guards[0].id;
		for (let i = 0; i < 5; i++) expect(await engine.startShift(g, '999999')).toBe(false);
		expect(engine.pinLockedFor()).toBeGreaterThan(0);
		expect(await engine.startShift(g, '246813')).toBe(false); // right PIN, still locked
		expect((await new GateEngine().load()).pinLockedFor()).toBeGreaterThan(0);
	});

	it('F3: a second console tab keeps working after the other tab rotates the token', async () => {
		await resetLocks();
		const { schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		const tabB = await new GateEngine().load(); // holds the current token in memory
		const db = await getDb();
		await db.update(schema.devices).set({ tokenIssuedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.devices.id, engine.config!.deviceId));
		expect((await engine.sync()).ok).toBe(true); // tab A rotates
		// Even after the old token's grace period, tab B must not present it.
		await db.update(schema.devices).set({ prevTokenValidUntil: new Date(Date.now() - 1000) }).where(eq(schema.devices.id, engine.config!.deviceId));
		expect((await tabB.sync()).ok).toBe(true);
		expect((await engine.sync()).ok).toBe(true);
	});

		it('checks in a result held in reactive UI state (proxied objects)', async () => {
		await resetLocks();
		const late = await passes.createPass(actor, { type: 'guest', visitorName: 'Proxy Guest' });
		const r = await engine.checkScan(late.token);
		const proxied = new Proxy(r, { get: (t, k) => (k === 'claims' ? new Proxy(t.claims!, {}) : Reflect.get(t, k)) });
		await expect(engine.checkIn(proxied)).resolves.toBeTruthy();
	});

		it('wipes itself when the estate manager removes the phone', async () => {
		online = true;
		await gate.revokeDevice(estateId, adminId, engine.config!.deviceId);
		const r = await engine.sync();
		expect(r).toEqual({ ok: false, error: 'device_removed' });
		expect(engine.enrolled).toBe(false);
		expect((await new GateEngine().load()).enrolled).toBe(false);
	});
});
