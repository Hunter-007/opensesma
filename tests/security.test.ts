/**
 * Regression tests for the 8 Oct 2026 security assessment (docs/security/).
 * Each test proves a finding stays fixed. IDs match the report.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

process.env.DATABASE_URL = 'memory://';
process.env.VITEST = 'true';
process.env.CRON_SECRET = 'test-cron-secret';

const { getDb, schema } = await import('../src/lib/server/db');
const { eq } = await import('drizzle-orm');
const auth = await import('../src/lib/server/auth');
const estates = await import('../src/lib/server/estates');
const passes = await import('../src/lib/server/passes');
const gate = await import('../src/lib/server/gate');
const admin = await import('../src/lib/server/admin');
const push = await import('../src/lib/server/push');
const { safeNext } = await import('../src/lib/shared/redirect');
const { evaluatePass } = await import('../src/lib/shared/evaluate');
const { peekPass } = await import('../src/lib/shared/passToken');

let estateId: string;
let adminId: string;
let unitId: string;
let gateId: string;
let actor: { userId: string; estateId: string; unitId: string };

beforeAll(async () => {
	await getDb();
	const c = await estates.createEstate({ name: 'Sec Estate', gateNames: ['Main'], admin: { phone: '08040000001', name: 'Admin' } });
	estateId = c.estate.id;
	adminId = c.admin.id;
	gateId = c.gates[0].id;
	const unit = await estates.addUnit(estateId, 'Palm Road', '7');
	unitId = unit.id;
	const resident = await estates.upsertUser('+2348040000002', 'Resident One');
	const inv = await estates.createInvite({ estateId, unitId, phone: resident.phone, name: 'Resident One', role: 'resident_primary', createdBy: adminId });
	await estates.acceptInvite(inv.code, resident);
	actor = { userId: resident.id, estateId, unitId };
});

async function enrolledDevice() {
	const d = await gate.createDevice(estateId, adminId, gateId, 'test phone');
	const { token } = await gate.enrollDevice(d.enrollCode!);
	return { token, device: await gate.authDevice(`Bearer ${token}`) };
}

describe('F1 — SMS cost abuse', () => {
	it('refuses login codes to numbers outside the allowed countries', async () => {
		await expect(auth.requestOtp('+44 7700 900123', { ip: '198.51.100.1' })).rejects.toThrow(/Nigerian/);
	});
	it('limits how many numbers one network can text', async () => {
		const ip = '198.51.100.2';
		for (let i = 0; i < 10; i++) await auth.requestOtp(`0805000${String(1000 + i)}`, { ip });
		await expect(auth.requestOtp('08050009999', { ip })).rejects.toThrow(/this network/);
	});
	it('limits code guesses per network across numbers', async () => {
		const ip = '198.51.100.3';
		let blocked = false;
		for (let i = 0; i < 35 && !blocked; i++) {
			try {
				await auth.verifyOtp(`0806000${String(1000 + i)}`, '000000', { ip });
			} catch (e) {
				if (/this network/.test((e as Error).message)) blocked = true;
			}
		}
		expect(blocked).toBe(true);
	});
});

describe('F2 — one pass admitting many people', () => {
	it('signs a daily entry cap into staff, artisan and multi-day passes', async () => {
		const artisan = await passes.createPass(actor, { type: 'artisan', visitorName: 'Emeka', purpose: 'Plumbing' });
		expect(peekPass(artisan.token)?.perDay).toBe(4);
		const multi = await passes.createPass(actor, { type: 'multiday', visitorName: 'Aunty', validTo: new Date(Date.now() + 86_400_000) });
		expect(peekPass(multi.token)?.perDay).toBe(6);
	});
	it('refuses entry once the daily cap is reached', async () => {
		const p = await passes.createPass(actor, { type: 'artisan', visitorName: 'Tunde', purpose: 'Painting' });
		const claims = peekPass(p.token)!;
		const ctx = { now: new Date(), estateId, timeZone: 'Africa/Lagos', entriesUsed: 4, revoked: false };
		expect(evaluatePass(claims, { ...ctx, entriesToday: 3 }).allow).toBe(true);
		const d = evaluatePass(claims, { ...ctx, entriesToday: 4 });
		expect(d.allow).toBe(false);
		if (!d.allow) expect(d.reason).toBe('daily_limit');
	});
	it('warns the guard when a personal pass is already inside', async () => {
		const p = await passes.createPass(actor, { type: 'artisan', visitorName: 'Sola', purpose: 'AC' });
		const d = evaluatePass(peekPass(p.token)!, { now: new Date(), estateId, timeZone: 'Africa/Lagos', entriesUsed: 1, entriesToday: 1, inside: true, revoked: false });
		expect(d.allow && d.warnings.some((w) => /already inside/.test(w))).toBe(true);
	});
	it('caps staff per house', async () => {
		const schedule = { days: [1, 2, 3, 4, 5], start: '07:00', end: '18:00' };
		for (let i = 0; i < passes.MAX_STAFF_PER_UNIT; i++) await passes.addStaffProfile(actor, { name: `Staff ${i}`, role: 'Cleaner', schedule });
		await expect(passes.addStaffProfile(actor, { name: 'One too many', role: 'Driver', schedule })).rejects.toThrow(/at most/);
	});
});

describe('F3 — gate phone exposure', () => {
	it('sends no pass signatures and no phone numbers to gate phones', async () => {
		await passes.createPass(actor, { type: 'guest', visitorName: 'Kemi', visitorPhone: '08051112222' });
		const { device } = await enrolledDevice();
		const sync = await gate.buildSync(device, {});
		const blob = JSON.stringify(sync);
		expect(blob).not.toMatch(/\+234\d{10}/);
		expect(sync.passes.every((p) => !('token' in p))).toBe(true);
		expect(sync.units!.every((u) => !('phone' in u))).toBe(true);
	});
	it('rotates the device token and blocks a stolen copy that is used later', async () => {
		const { token, device } = await enrolledDevice();
		const db = await getDb();
		await db.update(schema.devices).set({ tokenIssuedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.devices.id, device.id));
		const sync = await gate.buildSync(await gate.authDevice(`Bearer ${token}`), {});
		expect(sync.newToken).toBeTruthy();
		await expect(gate.authDevice(`Bearer ${sync.newToken}`)).resolves.toBeTruthy();
		// Old token still accepted briefly (lost reply)…
		await expect(gate.authDevice(`Bearer ${token}`)).resolves.toBeTruthy();
		// …but once the grace period is over, using it means a copy exists: block the device.
		await db.update(schema.devices).set({ prevTokenValidUntil: new Date(Date.now() - 1000) }).where(eq(schema.devices.id, device.id));
		await expect(gate.authDevice(`Bearer ${token}`)).rejects.toThrow(/removed/);
		await expect(gate.authDevice(`Bearer ${sync.newToken}`)).rejects.toThrow(/removed/);
	});
	it('expires a device token that has not been renewed for 30 days', async () => {
		const { token, device } = await enrolledDevice();
		const db = await getDb();
		await db.update(schema.devices).set({ tokenIssuedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(schema.devices.id, device.id));
		await expect(gate.authDevice(`Bearer ${token}`)).rejects.toThrow(/removed/);
	});
	it('refuses passes and walk-ins for banned visitors on the server', async () => {
		await admin.addBan(estateId, adminId, { name: 'Banned Person', phone: '08099990000', reason: 'theft' });
		await expect(passes.createPass(actor, { type: 'guest', visitorName: 'Someone', visitorPhone: '08099990000' })).rejects.toThrow(/ban list/);
		await expect(passes.createPass(actor, { type: 'guest', visitorName: 'banned person' })).rejects.toThrow(/ban list/);
		const { device } = await enrolledDevice();
		await expect(gate.createWalkin(device, { unitId, visitorName: 'Banned Person' })).rejects.toThrow(/ban list/);
	});
});

describe('F4 — open redirect', () => {
	it.each(['/\\evil.com', '//evil.com', '/%5Cevil.com', '/%2F%2Fevil.com', 'https://evil.com', '/\tevil.com', '/admin\\@evil.com', '/unknown-page'])('rejects %j', (n) => {
		expect(safeNext(n)).toBe('/');
	});
	it('keeps legitimate destinations', () => {
		expect(safeNext('/app/invite?type=guest')).toBe('/app/invite?type=guest');
		expect(safeNext('/join/K7QM-3XPA')).toBe('/join/K7QM-3XPA');
		expect(safeNext('/admin')).toBe('/admin');
	});
});

describe('F5 — guessable codes', () => {
	it('issues 8-digit codes', async () => {
		const p = await passes.createPass(actor, { type: 'delivery' });
		expect(p.code).toMatch(/^\d{8}$/);
	});
});

describe('F6 — server re-checks gate decisions', () => {
	it('flags an entry on a pass that was cancelled before it was used', async () => {
		const p = await passes.createPass(actor, { type: 'delivery' });
		await passes.revokePass(estateId, actor.userId, p.id);
		const { device } = await enrolledDevice();
		const r = await gate.ingestEvents(device, [{ id: uuidv7(), kind: 'entry', method: 'code', passId: p.id, deviceTs: Date.now(), offline: true }], { sentAt: Date.now() });
		expect(r.flagged).toHaveLength(1);
		const db = await getDb();
		const [e] = await db.select().from(schema.accessEvents).where(eq(schema.accessEvents.id, r.accepted[0]));
		expect(e.flag).toBe('revoked');
	});
	it('corrects and flags entries from a phone whose clock was moved', async () => {
		const p = await passes.createPass(actor, { type: 'guest', visitorName: 'Clock Test', validTo: new Date(Date.now() + 3_600_000) });
		const { device } = await enrolledDevice();
		const twoDaysAgo = Date.now() - 2 * 86_400_000;
		const r = await gate.ingestEvents(device, [{ id: uuidv7(), kind: 'entry', method: 'qr', passId: p.id, deviceTs: twoDaysAgo }], { sentAt: twoDaysAgo });
		expect(r.flagged).toHaveLength(1);
		const db = await getDb();
		const [e] = await db.select().from(schema.accessEvents).where(eq(schema.accessEvents.id, r.accepted[0]));
		expect(Math.abs(e.deviceTs.getTime() - Date.now())).toBeLessThan(60_000);
		expect(e.flag).toBe('clock_skew');
	});
	it('does not flag a normal entry', async () => {
		const p = await passes.createPass(actor, { type: 'guest', visitorName: 'Normal' });
		const { device } = await enrolledDevice();
		const r = await gate.ingestEvents(device, [{ id: uuidv7(), kind: 'entry', method: 'code', passId: p.id, deviceTs: Date.now() }], { sentAt: Date.now() });
		expect(r.flagged).toHaveLength(0);
	});
});

describe('F7 — CSV formula injection', () => {
	it('neutralises cells that spreadsheets would run', async () => {
		const { device } = await enrolledDevice();
		await gate.ingestEvents(device, [{ id: uuidv7(), kind: 'override', method: 'override', visitorName: '=HYPERLINK("https://evil.example","x")', reason: '+1+2', guardName: '@cmd', deviceTs: Date.now() }]);
		const csv = admin.eventsToCsv(await admin.listEvents(estateId, { kind: 'override' }), 'Africa/Lagos');
		expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
		expect(csv).toContain("'+1+2");
		expect(csv).toContain("'@cmd");
		expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
	});
});

describe('F8 — framing and content policy', () => {
	it('sets frame protection for every path, including static pages', () => {
		const toml = readFileSync('netlify.toml', 'utf8');
		expect(toml).toMatch(/for = "\/\*"[\s\S]*X-Frame-Options = "DENY"/);
		expect(toml).toMatch(/frame-ancestors 'none'/);
		expect(toml).toMatch(/Strict-Transport-Security/);
	});
	it('ships a Content-Security-Policy', () => {
		const cfg = readFileSync('svelte.config.js', 'utf8');
		expect(cfg).toMatch(/csp:/);
		expect(cfg).toMatch(/'frame-ancestors': \['none'\]/);
		expect(cfg).toMatch(/'object-src': \['none'\]/);
	});
});

describe('F9 — cross-estate house IDs', () => {
	it('refuses an invite for a house in another estate', async () => {
		const other = await estates.createEstate({ name: 'Other', gateNames: ['G'], admin: { phone: '08040000099', name: 'Other admin' } });
		const foreign = await estates.addUnit(other.estate.id, 'Far Street', '1');
		await expect(
			estates.createInvite({ estateId, unitId: foreign.id, phone: '+2348040000050', name: 'X', role: 'resident_primary', createdBy: adminId })
		).rejects.toThrow(/not found/);
	});
});

describe('F10 — push subscriptions', () => {
	const keys = { p256dh: 'BFAKE', auth: 'AUTH' };
	it('only accepts real browser push services', async () => {
		await expect(push.saveSubscription(actor.userId, { endpoint: 'https://attacker.example/hook', keys })).rejects.toThrow(/Unsupported/);
		await expect(push.saveSubscription(actor.userId, { endpoint: 'https://fcm.googleapis.com:8443/x', keys })).rejects.toThrow(/Unsupported/);
		await expect(push.saveSubscription(actor.userId, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).resolves.toBeUndefined();
	});
	it("can't take over someone else's subscription", async () => {
		const other = await estates.upsertUser('+2348040000077', 'Other');
		await expect(push.saveSubscription(other.id, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).rejects.toThrow(/someone else/);
	});
});

describe('F11 — guessing at the gate is reported', () => {
	it('accepts a burst of unknown-code denials and keeps counting them server-side', async () => {
		const { device } = await enrolledDevice();
		const events = Array.from({ length: 12 }, () => ({ id: uuidv7(), kind: 'deny' as const, method: 'code' as const, reason: 'unknown_code', deviceTs: Date.now() }));
		const r = await gate.ingestEvents(device, events, { sentAt: Date.now() });
		expect(r.accepted).toHaveLength(12);
		const db = await getDb();
		const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, `unknown-codes-alerted:${device.id}`));
		expect(row?.count).toBe(1); // the manager was alerted exactly once
	});
});

describe('F12 — health check', () => {
	it('tells the public only up or down', async () => {
		const { GET } = await import('../src/routes/api/health/+server');
		const res = await GET({ request: new Request('http://x/api/health') } as never);
		expect(Object.keys(await res.json())).toEqual(['ok']);
		const res2 = await GET({ request: new Request('http://x/api/health', { headers: { authorization: 'Bearer test-cron-secret' } }) } as never);
		expect(await res2.json()).toHaveProperty('database');
	});
});

describe('F13 — dues values', () => {
	it('rejects an unknown dues status', async () => {
		await expect(estates.setDuesStatus(estateId, adminId, unitId, 'hacked' as never)).rejects.toThrow(/paid, owing/);
	});
});

describe('F14 — staff accounts vs residents', () => {
	it("won't turn a resident into a guard", async () => {
		await expect(
			estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08040000002', name: 'Resident One', role: 'guard', pin: '123456' })
		).rejects.toThrow(/belongs to a resident/);
	});
});

describe('F15 — join requests', () => {
	it('joins an occupied house as a member, not head of household', async () => {
		const newcomer = await estates.upsertUser('+2348040000088', 'New Comer');
		await estates.requestToJoin(estateId, unitId, newcomer.id, 'New Comer', 'tenant');
		const db = await getDb();
		const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, newcomer.id));
		expect(m.role).toBe('resident_sub');
	});
});

describe('F16 — guard PINs', () => {
	it('requires 6-digit PINs', async () => {
		await expect(estates.addStaffAccount({ estateId, actorUserId: adminId, phone: '08040000111', name: 'G', role: 'guard', pin: '1234' })).rejects.toThrow(/6-digit/);
	});
});

describe('F17 — visitor page privacy', () => {
	it("doesn't expose the host's phone number", async () => {
		const p = await passes.createPass(actor, { type: 'guest', visitorName: 'Page Test' });
		const { load } = await import('../src/routes/p/[token]/+page.server');
		const data = (await load({ params: { token: p.token }, url: new URL(`http://x/p/${p.token}`), setHeaders: () => {} } as never)) as Record<string, unknown>;
		expect(JSON.stringify(data)).not.toMatch(/\+234/);
		expect(data.hostName).toBe('Resident');
	});
});

describe('F20 — setup and secrets', () => {
	it('closes /setup in production without a setup token', async () => {
		const { load } = await import('../src/routes/setup/+page.server');
		const prev = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		process.env.APP_SECRET = 'prod-like-secret-for-this-test-only';
		try {
			await expect(load({ url: new URL('http://x/setup') } as never)).rejects.toMatchObject({ status: 403 });
			process.env.SETUP_TOKEN = 'letmein';
			await expect(load({ url: new URL('http://x/setup?token=letmein') } as never)).resolves.toEqual({});
		} finally {
			process.env.NODE_ENV = prev;
			delete process.env.SETUP_TOKEN;
			delete process.env.APP_SECRET;
		}
	});
	it('can rotate APP_SECRET without losing estate keys', async () => {
		const { encryptSecret, decryptSecret } = await import('../src/lib/server/crypto');
		const enc = encryptSecret('signing-key');
		process.env.APP_SECRET_PREVIOUS = process.env.APP_SECRET ?? 'dev-only-insecure-secret-do-not-use-in-production';
		process.env.APP_SECRET = 'a-brand-new-secret-value-0123456789';
		try {
			expect(decryptSecret(enc)).toBe('signing-key');
		} finally {
			delete process.env.APP_SECRET;
			delete process.env.APP_SECRET_PREVIOUS;
		}
	});
});
