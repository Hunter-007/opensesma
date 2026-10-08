import { beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

process.env.DATABASE_URL = 'memory://';
process.env.SMS_DRIVER = 'console';
process.env.VITEST = 'true';

const { getDb, schema } = await import('../src/lib/server/db');
const auth = await import('../src/lib/server/auth');
const estates = await import('../src/lib/server/estates');
const passes = await import('../src/lib/server/passes');
const gate = await import('../src/lib/server/gate');
const admin = await import('../src/lib/server/admin');
const { devOutbox } = await import('../src/lib/server/sms');
const { verifyPass } = await import('../src/lib/shared/passToken');
const { evaluatePass } = await import('../src/lib/shared/evaluate');
const { verifyPin } = await import('../src/lib/shared/pin');

let estateId: string;
let gate1: string;
let gate2: string;
let adminId: string;
let unitId: string;
let residentId: string;
let device1: Awaited<ReturnType<typeof gate.authDevice>>;
let device2: Awaited<ReturnType<typeof gate.authDevice>>;

async function login(phone: string) {
	const { devCode } = await auth.requestOtp(phone);
	return auth.verifyOtp(phone, devCode!);
}

beforeAll(async () => {
	await getDb();
	const created = await estates.createEstate({
		name: 'Harmony Gardens',
		address: 'Sangotedo, Lagos',
		gateNames: ['Main gate', 'Back gate'],
		admin: { phone: '08030000001', name: 'Mrs Adebayo' }
	});
	estateId = created.estate.id;
	[gate1, gate2] = created.gates.map((g) => g.id);
	adminId = created.admin.id;
});

describe('PRD 1 — onboarding', () => {
	it('imports a household CSV, reporting bad rows without blocking good ones', async () => {
		const csv = `street,number,name,phone
Adeyemi Street,14,Bello Musa,0803 111 2222
Adeyemi Street,15,Ada Obi,not-a-phone
,16,Nobody,08031112223
Okafor Close,2,Chidi Nwosu,08031112224`;
		const report = estates.parseHouseholdCsv(csv);
		expect(report.valid).toHaveLength(2);
		expect(report.errors.map((e) => e.line)).toEqual([3, 4]);
		const res = await estates.commitHouseholdImport(estateId, adminId, report.valid, true);
		expect(res).toEqual({ unitsCreated: 2, invitesSent: 2 });
		expect(devOutbox[0].body).toContain('/join/');
	});

	it('lets a resident accept an invite via OTP and lands them in their household', async () => {
		const db = await getDb();
		const [invite] = await db.select().from(schema.invites).where(estates && (await import('drizzle-orm')).eq(schema.invites.phone, '+2348031112222'));
		const { userId } = await login('08031112222');
		const user = (await db.select().from(schema.users)).find((u) => u.id === userId)!;
		await estates.acceptInvite(invite.code.toLowerCase().replace('-', ''), user);
		const session = await auth.loadSession(await auth.createSession(userId));
		expect(session?.active?.membership.role).toBe('resident_primary');
		expect(session?.active?.unit?.number).toBe('14');
		unitId = session!.active!.unit!.id;
		residentId = userId;
	});

	it('refuses an invite used from the wrong phone number', async () => {
		const db = await getDb();
		const { eq } = await import('drizzle-orm');
		const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.phone, '+2348031112224'));
		const { userId } = await login('08099999999');
		const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
		await expect(estates.acceptInvite(invite.code, user)).rejects.toThrow(/different phone/);
	});

	it('locks an OTP after 3 wrong attempts', async () => {
		await auth.requestOtp('08055555555');
		for (let i = 0; i < 3; i++) await expect(auth.verifyOtp('08055555555', '000000')).rejects.toThrow(/Wrong code/);
		await expect(auth.verifyOtp('08055555555', '000000')).rejects.toThrow(/Too many/);
	});

	it('rate-limits OTP resends to one a minute', async () => {
		await auth.requestOtp('08066666666');
		await expect(auth.requestOtp('08066666666')).rejects.toThrow(/wait a minute/);
	});
});

describe('PRD 2 + 3 — passes verified at the gate', () => {
	beforeAll(async () => {
		await estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08077777777', name: 'Sunday (Guard)', role: 'guard', pin: '432198' });
		const d1 = await gate.createDevice(estateId, adminId, gate1, 'Main gate phone');
		const d2 = await gate.createDevice(estateId, adminId, gate2, 'Back gate phone');
		const e1 = await gate.enrollDevice(d1.enrollCode!.toLowerCase());
		const e2 = await gate.enrollDevice(d2.enrollCode!);
		device1 = await gate.authDevice(`Bearer ${e1.token}`);
		device2 = await gate.authDevice(`Bearer ${e2.token}`);
	});

	it('a setup code works only once', async () => {
		const d = await gate.createDevice(estateId, adminId, gate1, 'spare');
		await gate.enrollDevice(d.enrollCode!);
		await expect(gate.enrollDevice(d.enrollCode!)).rejects.toThrow(/wrong or expired/);
	});

	it('full sync gives the device everything needed to work offline', async () => {
		const p = await passes.createPass({ userId: residentId, estateId, unitId }, { type: 'guest', visitorName: 'Chidi Okafor' });
		const sync = await gate.buildSync(device1, {});
		expect(sync.estate.publicKey).toBeTruthy();
		expect(sync.units!.length).toBe(2);
		expect(sync.guards![0].name).toBe('Sunday (Guard)');
		expect(await verifyPin('432198', sync.guards![0].pinHash)).toBe(true);
		const cached = sync.passes.find((x) => x.code === p.code)!;
		expect(evaluatePass(cached.claims, { now: new Date(), estateId, timeZone: 'Africa/Lagos', entriesUsed: 0, revoked: false }).allow).toBe(true);
		// The real QR (held by the visitor) still verifies against the estate key.
		expect(verifyPass(p.token, sync.estate.publicKey).ok).toBe(true);

		// Delta sync with unchanged hashes returns no reference data.
		const delta = await gate.buildSync(device1, { since: sync.cursor, unitsHash: sync.unitsHash, guardsHash: sync.guardsHash, bansHash: sync.bansHash });
		expect(delta.units).toBeUndefined();
		expect(delta.guards).toBeUndefined();
	});

	it('revocation reaches the gate on the next sync', async () => {
		const first = await gate.buildSync(device1, {});
		const p = await passes.createPass({ userId: residentId, estateId, unitId }, { type: 'delivery' });
		await passes.revokePass(estateId, residentId, p.id, { unitId });
		const delta = await gate.buildSync(device1, { since: first.cursor });
		expect(delta.passes.find((x) => x.id === p.id)?.status).toBe('revoked');
	});

	it('records offline check-ins idempotently (resent batches are not double-counted)', async () => {
		const p = await passes.createPass({ userId: residentId, estateId, unitId }, { type: 'multiday', visitorName: 'Aunty Ngozi', validTo: new Date(Date.now() + 3 * 86_400_000) });
		const events = Array.from({ length: 200 }, (_, i) => ({
			id: uuidv7(),
			kind: (i % 2 ? 'exit' : 'entry') as 'entry' | 'exit',
			method: 'code' as const,
			passId: p.id,
			visitorName: 'Aunty Ngozi',
			deviceTs: Date.now() - (200 - i) * 1000,
			offline: true
		}));
		const r1 = await gate.ingestEvents(device1, events);
		const r2 = await gate.ingestEvents(device1, events); // network dropped, device resends
		expect(r1.accepted).toHaveLength(200);
		expect(r2.accepted).toHaveLength(200);
		const db = await getDb();
		const { eq } = await import('drizzle-orm');
		const rows = await db.select().from(schema.accessEvents).where(eq(schema.accessEvents.passId, p.id));
		expect(rows).toHaveLength(200);
		const [updated] = await db.select().from(schema.passes).where(eq(schema.passes.id, p.id));
		expect(updated.entriesUsed).toBe(100);
	});

	it('flags a conflict when two offline gates admit the same one-time pass', async () => {
		const p = await passes.createPass({ userId: residentId, estateId, unitId }, { type: 'guest', visitorName: 'Twin Visitor' });
		const ev = () => ({ id: uuidv7(), kind: 'entry' as const, method: 'qr' as const, passId: p.id, visitorName: 'Twin Visitor', deviceTs: Date.now(), offline: true });
		const a = await gate.ingestEvents(device1, [ev()]);
		const b = await gate.ingestEvents(device2, [ev()]);
		expect(a.conflicts).toHaveLength(0);
		expect(b.conflicts).toHaveLength(1);
		const log = await admin.listEvents(estateId, { conflictsOnly: true });
		expect(log).toHaveLength(1);
	});

	it('logs overrides with a reason and counts them on the dashboard', async () => {
		await gate.ingestEvents(device1, [
			{ id: uuidv7(), kind: 'override', method: 'override', visitorName: 'Inspector Bala', reason: 'Official / police', guardName: 'Sunday', unitId, deviceTs: Date.now() }
		]);
		const d = await admin.dashboard(estateId, 'Africa/Lagos');
		expect(d.overridesWeek).toBe(1);
		expect(d.devices.filter((x) => x.enrolled).length).toBeGreaterThanOrEqual(2);
	});

	it('ban list reaches gate devices', async () => {
		const first = await gate.buildSync(device1, {});
		await admin.addBan(estateId, adminId, { name: 'Musa Ibrahim', phone: '08012345678', reason: 'Former driver, theft' });
		const delta = await gate.buildSync(device1, { since: first.cursor, bansHash: first.bansHash });
		expect(delta.bans?.[0].name).toBe('Musa Ibrahim');
	});
});

describe('PRD 2 — pass rules', () => {
	it('applies type defaults: delivery = 1 entry for 2 hours', async () => {
		const p = await passes.createPass({ userId: residentId, estateId, unitId }, { type: 'delivery' });
		expect(p.maxEntries).toBe(1);
		expect(Math.round((p.validTo!.getTime() - p.validFrom.getTime()) / 3_600_000)).toBe(2);
		expect(p.code).toMatch(/^\d{8}$/);
	});

	it('requires a capacity and end time for event passes', async () => {
		await expect(passes.createPass({ userId: residentId, estateId, unitId }, { type: 'event', maxEntries: 40 })).rejects.toThrow(/ends/);
		const p = await passes.createPass(
			{ userId: residentId, estateId, unitId },
			{ type: 'event', visitorName: "Tolu's 40th", maxEntries: 40, validTo: new Date(Date.now() + 9 * 3_600_000) }
		);
		expect(p.maxEntries).toBe(40);
	});

	it('levy rule "restrict" pauses event passes for owing households but keeps essentials', async () => {
		await estates.updateSettings(estateId, adminId, { levyRule: 'restrict' });
		await estates.setDuesStatus(estateId, adminId, unitId, 'owing');
		await expect(
			passes.createPass({ userId: residentId, estateId, unitId }, { type: 'event', maxEntries: 10, validTo: new Date(Date.now() + 3_600_000) })
		).rejects.toThrow(/outstanding estate dues/);
		await expect(passes.createPass({ userId: residentId, estateId, unitId }, { type: 'delivery' })).resolves.toBeTruthy();
		await estates.setDuesStatus(estateId, adminId, unitId, 'paid');
		await estates.updateSettings(estateId, adminId, { levyRule: 'warn' });
	});

	it('builds a WhatsApp-ready share message with the code', async () => {
		const p = await passes.createPass({ userId: residentId, estateId, unitId }, { type: 'guest', visitorName: 'Kemi Ade' });
		const estate = await estates.getEstate(estateId);
		const msg = passes.shareMessage(p, estate, '14 Adeyemi Street');
		expect(msg).toContain(`${p.code.slice(0, 4)} ${p.code.slice(4)}`);
		expect(msg).toContain("You've been invited to 14 Adeyemi Street");
		expect(msg).toContain('Hi Kemi');
		expect(msg).toContain('/p/');
	});
});

describe('PRD 4 — walk-in approval', () => {
	it('falls back to SMS when nobody has push, and the first decision wins', async () => {
		const before = devOutbox.length;
		const w = await gate.createWalkin(device1, { unitId, visitorName: 'Emeka', purpose: 'Plumber', guardName: 'Sunday' });
		expect(devOutbox.length).toBeGreaterThan(before);
		expect(devOutbox[0].body).toContain('/w/');

		const first = await gate.decideWalkin(w.id, true, { userId: residentId, name: 'Bello' });
		expect(first.alreadyDecided).toBe(false);
		const second = await gate.decideWalkin(w.id, false, { userId: null, name: 'SMS' });
		expect(second.alreadyDecided).toBe(true);

		const status = await gate.pollWalkin(device1, w.id);
		expect(status.status).toBe('approved');
		expect(status.decidedByName).toBe('Bello');
		expect(status.pass?.code).toMatch(/^\d{8}$/);
	});
});

describe('Data protection', () => {
	it('anonymises visitor data past the retention period', async () => {
		await gate.ingestEvents(device1, [
			{ id: uuidv7(), kind: 'entry', method: 'walkin', visitorName: 'Old Visitor', unitId, deviceTs: Date.now() - 6 * 86_400_000 }
		]);
		const db = await getDb();
		const { eq, sql } = await import('drizzle-orm');
		await db.execute(sql`update access_events set device_ts = now() - interval '13 months' where visitor_name = 'Old Visitor'`);
		const r = await gate.runRetention();
		expect(r.anonymised).toBeGreaterThanOrEqual(1);
		const left = await db.select().from(schema.accessEvents).where(eq(schema.accessEvents.visitorName, 'Old Visitor'));
		expect(left).toHaveLength(0);
	});
});
