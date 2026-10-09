/**
 * One-time sign-in links (no SMS login codes in the MVP).
 */
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = 'memory://';
process.env.VITEST = 'true';

const { getDb, schema } = await import('../src/lib/server/db');
const { eq } = await import('drizzle-orm');
const auth = await import('../src/lib/server/auth');
const estates = await import('../src/lib/server/estates');
const links = await import('../src/lib/server/links');
const { listMembers } = await import('../src/lib/server/admin');

let estateId: string;
let adminId: string;
let unitId: string;
let residentMembershipId: string;

const tokenOf = (url: string) => url.split('/l/')[1];

beforeAll(async () => {
	await getDb();
	const c = await estates.createEstate({ name: 'Link Estate', gateNames: ['Main'], admin: { phone: '08050000001', name: 'Manager' } });
	estateId = c.estate.id;
	adminId = c.admin.id;
	unitId = (await estates.addUnit(estateId, 'Palm Road', '3')).id;
	const resident = await estates.upsertUser('+2348050000002', 'Ngozi Eze');
	const inv = await estates.createInvite({ estateId, unitId, phone: resident.phone, name: 'Ngozi Eze', role: 'resident_primary', createdBy: adminId });
	await estates.acceptInvite(inv.code, resident);
	residentMembershipId = (await listMembers(estateId)).find((m) => m.userId === resident.id)!.id;
});

describe('sign-in links', () => {
	it('signs the member in once, then stops working', async () => {
		const link = await links.createSignInLink(estateId, adminId, residentMembershipId);
		expect(link.message).toContain('/l/');
		expect(link.message).toContain('Hi Ngozi');
		const token = tokenOf(link.url);
		// Opening the page (as WhatsApp's preview does) doesn't use the link.
		expect(await links.findSignInLink(token)).toMatchObject({ name: 'Ngozi Eze', estateName: 'Link Estate' });
		expect(await links.findSignInLink(token)).not.toBeNull();

		const session = await links.useSignInLink(token);
		const ctx = await auth.loadSession(session);
		expect(ctx?.user.name).toBe('Ngozi Eze');
		expect(ctx?.active?.estate.id).toBe(estateId);

		await expect(links.useSignInLink(token)).rejects.toMatchObject({ code: 'link_invalid' });
		expect(await links.findSignInLink(token)).toBeNull();
	});

	it('stores only a hash of the token', async () => {
		const link = await links.createSignInLink(estateId, adminId, residentMembershipId);
		const db = await getDb();
		const rows = await db.select().from(schema.loginLinks);
		expect(JSON.stringify(rows)).not.toContain(tokenOf(link.url));
	});

	it('a new link cancels the older unused one', async () => {
		const first = await links.createSignInLink(estateId, adminId, residentMembershipId);
		const second = await links.createSignInLink(estateId, adminId, residentMembershipId);
		await expect(links.useSignInLink(tokenOf(first.url))).rejects.toMatchObject({ code: 'link_invalid' });
		await expect(links.useSignInLink(tokenOf(second.url))).resolves.toBeTypeOf('string');
	});

	it('expires after 3 days', async () => {
		const link = await links.createSignInLink(estateId, adminId, residentMembershipId);
		const db = await getDb();
		await db.update(schema.loginLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.loginLinks.userId, (await listMembers(estateId)).find((m) => m.id === residentMembershipId)!.userId));
		await expect(links.useSignInLink(tokenOf(link.url))).rejects.toMatchObject({ code: 'link_invalid' });
	});

	it('rejects garbage tokens without touching the database', async () => {
		await expect(links.useSignInLink('../../etc')).rejects.toMatchObject({ code: 'link_invalid' });
		expect(await links.findSignInLink('x')).toBeNull();
	});

	it("can't be made for someone in another estate", async () => {
		const other = await estates.createEstate({ name: 'Other Estate', gateNames: ['Gate'], admin: { phone: '08050000009', name: 'Other Manager' } });
		// Manager of the other estate can't reach this estate's members at all…
		await expect(links.createSignInLink(other.estate.id, other.admin.id, residentMembershipId)).rejects.toMatchObject({ status: 404 });
		// …and if a person belongs to both estates, neither manager can issue them a link.
		const both = await estates.upsertUser('+2348050000010', 'Two Estates');
		const u2 = await estates.addUnit(other.estate.id, 'Elm', '1');
		for (const [e, u, by] of [[estateId, unitId, adminId], [other.estate.id, u2.id, other.admin.id]] as const) {
			const inv = await estates.createInvite({ estateId: e, unitId: u, phone: both.phone, name: 'Two Estates', role: 'resident_sub', createdBy: by });
			await estates.acceptInvite(inv.code, both);
		}
		const m = (await listMembers(estateId)).find((x) => x.userId === both.id)!;
		await expect(links.createSignInLink(estateId, adminId, m.id)).rejects.toMatchObject({ code: 'other_estate' });
	});

	it('stops working when the member is removed', async () => {
		const u = await estates.upsertUser('+2348050000020', 'Leaving Soon');
		const inv = await estates.createInvite({ estateId, unitId, phone: u.phone, name: 'Leaving Soon', role: 'resident_sub', createdBy: adminId });
		await estates.acceptInvite(inv.code, u);
		const m = (await listMembers(estateId)).find((x) => x.userId === u.id)!;
		const link = await links.createSignInLink(estateId, adminId, m.id);
		await estates.deactivateMember(estateId, adminId, m.id);
		await expect(links.useSignInLink(tokenOf(link.url))).rejects.toMatchObject({ code: 'not_member' });
	});
});

describe('invite links sign people in', () => {
	it('joins the household and starts a session, once', async () => {
		const inv = await estates.createInvite({ estateId, unitId, phone: '+2348050000030', name: 'Tunde', role: 'resident_sub', createdBy: adminId });
		const r = await links.acceptInviteAndSignIn(inv.code, 'Tunde Bakare');
		const ctx = await auth.loadSession(r.session);
		expect(ctx?.user.phone).toBe('+2348050000030');
		expect(ctx?.user.name).toBe('Tunde Bakare');
		expect(ctx?.active?.unit?.id).toBe(unitId);
		await expect(links.acceptInviteAndSignIn(inv.code, 'Again')).rejects.toMatchObject({ code: 'invite_invalid' });
	});

	it('household invites come back as a message to share', async () => {
		const res = await estates.addHouseholdMember({ estateId, unitId, actorUserId: adminId, phone: '0805 000 0040', name: 'Chioma' });
		expect(res.message).toContain('/join/');
		expect(res.message).toContain('3 Palm Road');
		expect(res.phone).toBe('+2348050000040');
	});
});

describe('setup', () => {
	it('can add a test house, resident and guard', async () => {
		const c = await estates.createEstate({ name: 'Demo Estate', gateNames: ['Main gate'], admin: { phone: '08050000050', name: 'Demo Manager' } });
		await estates.addDemoData(c.estate.id, c.admin.id, '482913');
		const members = await listMembers(c.estate.id);
		const resident = members.find((m) => m.name === 'Ada Test')!;
		expect(resident.role).toBe('resident_primary');
		expect(members.find((m) => m.name === 'Test Guard')?.hasPin).toBe(true);
		const link = await links.createSignInLink(c.estate.id, c.admin.id, resident.id);
		const session = await links.useSignInLink(tokenOf(link.url));
		expect((await auth.loadSession(session))?.active?.unit?.number).toBe('1');
	});
});
