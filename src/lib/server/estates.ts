import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import Papa from 'papaparse';
import { getDb, schema } from './db';
import { encryptSecret, decryptSecret } from './crypto';
import { sendSms } from './sms';
import { AppError, audit, unitLabel } from './util';
import { config } from './config';
import { generateSigningKey } from '../shared/passToken';
import { humanCode, normaliseHumanCode, randomId } from '../shared/encoding';
import { normalisePhone } from '../shared/phone';
import { DEFAULT_SETTINGS, type EstateSettings, type Role, isResidentRole } from '../shared/types';
import { hashPin, isValidPin } from '../shared/pin';

const INVITE_DAYS = 14;

export async function createEstate(input: {
	name: string;
	address?: string;
	timeZone?: string;
	gateNames: string[];
	admin: { phone: string; name: string };
	settings?: Partial<EstateSettings>;
}) {
	const db = await getDb();
	const phone = normalisePhone(input.admin.phone);
	if (!phone) throw new AppError('Invalid admin phone');
	const keys = generateSigningKey();
	const estateId = randomId(10);
	const [estate] = await db
		.insert(schema.estates)
		.values({
			id: estateId,
			name: input.name.trim(),
			address: input.address?.trim() ?? '',
			timeZone: input.timeZone ?? 'Africa/Lagos',
			settings: { ...DEFAULT_SETTINGS, ...input.settings },
			signingPublicKey: keys.publicKey,
			signingSecretKeyEnc: encryptSecret(keys.secretKey)
		})
		.returning();
	const gates = await db
		.insert(schema.gates)
		.values(input.gateNames.map((name) => ({ id: randomId(10), estateId, name })))
		.returning();
	const user = await upsertUser(phone, input.admin.name);
	await db.insert(schema.memberships).values({
		id: randomId(),
		userId: user.id,
		estateId,
		role: 'estate_admin',
		status: 'active'
	});
	await audit(db, { estateId, actorUserId: user.id, action: 'estate.create', entity: 'estate', entityId: estateId });
	return { estate, gates, admin: user };
}

export async function getEstate(estateId: string) {
	const db = await getDb();
	const [estate] = await db.select().from(schema.estates).where(eq(schema.estates.id, estateId)).limit(1);
	if (!estate) throw new AppError('Estate not found', 404, 'not_found');
	return estate;
}

export const estateSecretKey = (estate: { signingSecretKeyEnc: string }) => decryptSecret(estate.signingSecretKeyEnc);

export async function updateSettings(estateId: string, actorUserId: string, patch: Partial<EstateSettings> & { name?: string; address?: string }) {
	const db = await getDb();
	const estate = await getEstate(estateId);
	const { name, address, ...settingsPatch } = patch;
	const settings = { ...estate.settings, ...settingsPatch };
	await db
		.update(schema.estates)
		.set({ settings, ...(name ? { name } : {}), ...(address !== undefined ? { address } : {}) })
		.where(eq(schema.estates.id, estateId));
	await audit(db, { estateId, actorUserId, action: 'estate.settings', entity: 'estate', entityId: estateId, data: patch });
}

export async function upsertUser(phone: string, name: string) {
	const db = await getDb();
	const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
	if (existing) {
		if (!existing.name && name) {
			await db.update(schema.users).set({ name }).where(eq(schema.users.id, existing.id));
			existing.name = name;
		}
		return existing;
	}
	const [user] = await db.insert(schema.users).values({ id: randomId(), phone, name }).returning();
	return user;
}

/**
 * Test data for trying an estate end to end: one house with a resident and
 * one guard. Their phone numbers are made up (nothing is ever sent to them);
 * the manager signs the resident in with a sign-in link from People.
 */
export async function addDemoData(estateId: string, actorUserId: string, guardPin: string) {
	const db = await getDb();
	const fakePhone = () => `+234709${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
	const unit = await addUnit(estateId, 'Demo Street', '1');
	const resident = await upsertUser(fakePhone(), 'Ada Test');
	await db.insert(schema.memberships).values({ id: randomId(), userId: resident.id, estateId, unitId: unit.id, role: 'resident_primary', status: 'active', approvedBy: actorUserId });
	await addStaffAccount({ estateId, actorUserId, phone: fakePhone(), name: 'Test Guard', role: 'guard', pin: guardPin });
	await audit(db, { estateId, actorUserId, action: 'estate.demo_data', entity: 'estate', entityId: estateId });
	return { unit, resident };
}

// ---------------------------------------------------------------- units

export async function addUnit(estateId: string, street: string, number: string) {
	const db = await getDb();
	const s = street.trim();
	const n = number.trim();
	if (!s || !n) throw new AppError('Street and house number are required');
	const [unit] = await db
		.insert(schema.units)
		.values({ id: randomId(10), estateId, street: s, number: n })
		.onConflictDoUpdate({
			target: [schema.units.estateId, schema.units.street, schema.units.number],
			set: { active: true }
		})
		.returning();
	return unit;
}

export async function setDuesStatus(estateId: string, actorUserId: string, unitId: string, status: 'paid' | 'owing' | 'unknown', note = '') {
	if (!['paid', 'owing', 'unknown'].includes(status)) throw new AppError('Choose paid, owing or not set');
	const db = await getDb();
	await db
		.update(schema.units)
		.set({ duesStatus: status, duesNote: note })
		.where(and(eq(schema.units.id, unitId), eq(schema.units.estateId, estateId)));
	// Bump the unit's passes so gate devices pick up the new dues warning on next sync.
	await db
		.update(schema.passes)
		.set({ updatedAt: new Date() })
		.where(and(eq(schema.passes.unitId, unitId), eq(schema.passes.status, 'active')));
	await audit(db, { estateId, actorUserId, action: 'unit.dues', entity: 'unit', entityId: unitId, data: { status, note } });
}

export interface ImportRow {
	line: number;
	street: string;
	number: string;
	name: string;
	phone: string | null;
	role: Role;
}
export interface ImportReport {
	valid: ImportRow[];
	errors: { line: number; message: string; raw: string }[];
}

/**
 * Parse a household CSV. Accepted headers (case-insensitive):
 * street | block, number | house, name, phone, role (owner/tenant/landlord, optional).
 */
export function parseHouseholdCsv(text: string): ImportReport {
	const parsed = Papa.parse<Record<string, string>>(text.trim(), {
		header: true,
		skipEmptyLines: true,
		transformHeader: (h) => h.trim().toLowerCase()
	});
	const report: ImportReport = { valid: [], errors: [] };
	parsed.data.forEach((row, i) => {
		const line = i + 2; // +1 header, +1 human counting
		const street = (row.street ?? row.block ?? row['street/block'] ?? '').trim();
		const number = (row.number ?? row.house ?? row['house number'] ?? row.unit ?? '').trim();
		const name = (row.name ?? row['primary name'] ?? '').trim();
		const rawPhone = (row.phone ?? row['phone number'] ?? '').trim();
		const raw = Object.values(row).join(', ');
		if (!street || !number) return report.errors.push({ line, message: 'Missing street or house number', raw });
		const phone = rawPhone ? normalisePhone(rawPhone) : null;
		if (rawPhone && !phone) return report.errors.push({ line, message: `Invalid phone "${rawPhone}"`, raw });
		report.valid.push({ line, street, number, name, phone, role: 'resident_primary' });
	});
	return report;
}

export async function commitHouseholdImport(estateId: string, actorUserId: string, rows: ImportRow[], sendInvites: boolean) {
	let unitsCreated = 0;
	let invitesSent = 0;
	for (const row of rows) {
		const unit = await addUnit(estateId, row.street, row.number);
		unitsCreated++;
		if (row.phone) {
			const invite = await createInvite({ estateId, unitId: unit.id, phone: row.phone, name: row.name, role: row.role, createdBy: actorUserId });
			if (sendInvites && config.smsLoginEnabled) {
				await sendInviteSms(invite.code, row.phone, row.name);
				invitesSent++;
			}
		}
	}
	const db = await getDb();
	await audit(db, { estateId, actorUserId, action: 'units.import', entity: 'unit', data: { unitsCreated, invitesSent } });
	return { unitsCreated, invitesSent };
}

// ---------------------------------------------------------------- invites & membership

export async function createInvite(input: { estateId: string; unitId: string | null; phone: string | null; name: string; role: Role; createdBy: string }) {
	const db = await getDb();
	// Never trust a house ID from a form: it must belong to this estate.
	if (input.unitId) {
		const [unit] = await db
			.select({ id: schema.units.id })
			.from(schema.units)
			.where(and(eq(schema.units.id, input.unitId), eq(schema.units.estateId, input.estateId)));
		if (!unit) throw new AppError('House not found on this estate', 404, 'not_found');
	}
	const [invite] = await db
		.insert(schema.invites)
		.values({
			id: randomId(),
			estateId: input.estateId,
			unitId: input.unitId,
			code: humanCode(8),
			phone: input.phone,
			name: input.name,
			role: input.role,
			expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
			createdBy: input.createdBy
		})
		.returning();
	return invite;
}

export const inviteUrl = (code: string) => `${config.publicUrl}/join/${code}`;

/** The invite the manager sends on WhatsApp or by text. Opening it signs the person in. */
export function inviteMessage(name: string, estateName: string, house: string | null, code: string) {
	const first = name.trim().split(' ')[0];
	return [
		first ? `Hi ${first},` : 'Hello,',
		`you've been invited to ${house ? `${house}, ` : ''}${estateName} on OpenSesma — the app for sending gate passes to your visitors.`,
		'',
		`Tap to join: ${inviteUrl(code)}`,
		'',
		"The link works once and signs you in on your phone. Don't forward it."
	].join('\n');
}

export async function sendInviteSms(code: string, phone: string, name: string) {
	const hi = name ? `Hi ${name.split(' ')[0]}, ` : '';
	return sendSms(phone, `${hi}you've been invited to your estate on OpenSesma. Join here: ${inviteUrl(code)}`);
}

export async function findInvite(rawCode: string) {
	const db = await getDb();
	const code = normaliseHumanCode(rawCode);
	const [row] = await db
		.select({ invite: schema.invites, estate: schema.estates, unit: schema.units })
		.from(schema.invites)
		.innerJoin(schema.estates, eq(schema.estates.id, schema.invites.estateId))
		.leftJoin(schema.units, eq(schema.units.id, schema.invites.unitId))
		.where(and(eq(schema.invites.code, code), isNull(schema.invites.usedAt), gt(schema.invites.expiresAt, new Date())))
		.limit(1);
	return row ?? null;
}

/** Invites are pre-approved by whoever created them, so accepting one activates the membership. */
export async function acceptInvite(rawCode: string, user: { id: string; phone: string; name: string }, name?: string) {
	const db = await getDb();
	const found = await findInvite(rawCode);
	if (!found) throw new AppError('This invite link has expired or was already used. Ask your estate manager for a new one.', 400, 'invite_invalid');
	const { invite } = found;
	if (invite.phone && invite.phone !== user.phone)
		throw new AppError('This invite was sent to a different phone number. Sign in with that number.', 403, 'invite_wrong_phone');

	const displayName = (name ?? '').trim() || invite.name || user.name;
	if (displayName && displayName !== user.name) await db.update(schema.users).set({ name: displayName }).where(eq(schema.users.id, user.id));

	await db
		.insert(schema.memberships)
		.values({ id: randomId(), userId: user.id, estateId: invite.estateId, unitId: invite.unitId, role: invite.role, status: 'active', approvedBy: invite.createdBy })
		.onConflictDoUpdate({
			target: [schema.memberships.userId, schema.memberships.estateId],
			set: { unitId: invite.unitId, role: invite.role, status: 'active', approvedBy: invite.createdBy }
		});
	await db.update(schema.invites).set({ usedAt: new Date() }).where(eq(schema.invites.id, invite.id));
	await audit(db, { estateId: invite.estateId, actorUserId: user.id, action: 'invite.accept', entity: 'invite', entityId: invite.id });
	return found.estate;
}

/** Someone without an invite asks to join a house; an admin approves it. */
export async function requestToJoin(estateId: string, unitId: string, userId: string, name: string, proofNote: string) {
	const db = await getDb();
	const [unit] = await db.select().from(schema.units).where(and(eq(schema.units.id, unitId), eq(schema.units.estateId, estateId))).limit(1);
	if (!unit) throw new AppError('Choose your house from the list');
	if (name.trim()) await db.update(schema.users).set({ name: name.trim() }).where(eq(schema.users.id, userId));
	// If the house already has a head of household, a newcomer joins as a member,
	// so a hasty approval can't hand a stranger control of someone's household.
	const [head] = await db
		.select({ id: schema.memberships.id })
		.from(schema.memberships)
		.where(and(eq(schema.memberships.unitId, unitId), eq(schema.memberships.role, 'resident_primary'), eq(schema.memberships.status, 'active')));
	await db
		.insert(schema.memberships)
		.values({ id: randomId(), userId, estateId, unitId, role: head ? 'resident_sub' : 'resident_primary', status: 'pending', proofNote: proofNote.slice(0, 500) })
		.onConflictDoNothing();
	await audit(db, { estateId, actorUserId: userId, action: 'membership.request', entity: 'unit', entityId: unitId, data: { proofNote } });
}

export async function decideMembership(estateId: string, actorUserId: string, membershipId: string, approve: boolean, role?: Role) {
	const db = await getDb();
	const [m] = await db
		.update(schema.memberships)
		.set({ status: approve ? 'active' : 'disabled', approvedBy: actorUserId, ...(role ? { role } : {}) })
		.where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.estateId, estateId)))
		.returning();
	if (!m) throw new AppError('Request not found', 404, 'not_found');
	await audit(db, { estateId, actorUserId, action: approve ? 'membership.approve' : 'membership.reject', entity: 'membership', entityId: membershipId });
	if (approve) {
		const [u] = await db.select().from(schema.users).where(eq(schema.users.id, m.userId));
		if (u) await sendSms(u.phone, `You've been approved on OpenSesma. Open ${config.publicUrl}/app to invite your visitors.`);
	}
	return m;
}

/**
 * Deactivating a member revokes every pass they created (PRD 1: moving out).
 * Primary residents may deactivate their own household members; admins anyone.
 */
export async function deactivateMember(estateId: string, actorUserId: string, membershipId: string) {
	const db = await getDb();
	const [m] = await db
		.update(schema.memberships)
		.set({ status: 'disabled' })
		.where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.estateId, estateId)))
		.returning();
	if (!m) throw new AppError('Member not found', 404, 'not_found');
	await db
		.update(schema.passes)
		.set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.passes.estateId, estateId), eq(schema.passes.createdBy, m.userId), eq(schema.passes.status, 'active')));
	await audit(db, { estateId, actorUserId, action: 'membership.deactivate', entity: 'membership', entityId: membershipId });
}

export async function addHouseholdMember(input: {
	estateId: string;
	unitId: string;
	actorUserId: string;
	phone: string;
	name: string;
}) {
	const db = await getDb();
	const estate = await getEstate(input.estateId);
	const phone = normalisePhone(input.phone);
	if (!phone) throw new AppError('Enter a valid phone number');
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(schema.memberships)
		.where(
			and(
				eq(schema.memberships.unitId, input.unitId),
				eq(schema.memberships.role, 'resident_sub'),
				ne(schema.memberships.status, 'disabled')
			)
		);
	if (count >= estate.settings.maxSubResidents)
		throw new AppError(`A household can have at most ${estate.settings.maxSubResidents} members besides the primary resident`);
	const invite = await createInvite({ estateId: input.estateId, unitId: input.unitId, phone, name: input.name, role: 'resident_sub', createdBy: input.actorUserId });
	if (config.smsLoginEnabled && config.smsDriver === 'termii') await sendInviteSms(invite.code, phone, input.name);
	const [unit] = await db.select().from(schema.units).where(eq(schema.units.id, input.unitId));
	return { invite, phone, message: inviteMessage(input.name, estate.name, unit ? `${unit.number} ${unit.street}` : null, invite.code) };
}

export async function addStaffAccount(input: {
	estateId: string;
	actorUserId: string;
	phone: string;
	name: string;
	role: Extract<Role, 'guard' | 'security_officer' | 'estate_admin'>;
	pin?: string;
}) {
	const db = await getDb();
	const phone = normalisePhone(input.phone);
	if (!phone) throw new AppError('Enter a valid phone number');
	if (input.role === 'guard' && (!input.pin || !isValidPin(input.pin))) throw new AppError('Guards need a 6-digit PIN');
	const user = await upsertUser(phone, input.name.trim());
	// Don't silently turn a resident into staff: that would drop them from their house.
	const [existing] = await db
		.select({ role: schema.memberships.role, status: schema.memberships.status })
		.from(schema.memberships)
		.where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.estateId, input.estateId)));
	if (existing && existing.status !== 'disabled' && isResidentRole(existing.role))
		throw new AppError('That phone number belongs to a resident of this estate. Use a different number for staff accounts.', 409, 'is_resident');
	const pinHash = input.pin ? await hashPin(input.pin) : null;
	await db
		.insert(schema.memberships)
		.values({ id: randomId(), userId: user.id, estateId: input.estateId, role: input.role, status: 'active', pinHash, approvedBy: input.actorUserId })
		.onConflictDoUpdate({
			target: [schema.memberships.userId, schema.memberships.estateId],
			set: { role: input.role, status: 'active', pinHash, unitId: null }
		});
	await audit(db, { estateId: input.estateId, actorUserId: input.actorUserId, action: 'staff.add', entity: 'user', entityId: user.id, data: { role: input.role } });
	return user;
}

export async function resetGuardPin(estateId: string, actorUserId: string, membershipId: string, pin: string) {
	if (!isValidPin(pin)) throw new AppError('PIN must be 6 digits');
	const db = await getDb();
	await db
		.update(schema.memberships)
		.set({ pinHash: await hashPin(pin) })
		.where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.estateId, estateId), eq(schema.memberships.role, 'guard')));
	await audit(db, { estateId, actorUserId, action: 'guard.pin_reset', entity: 'membership', entityId: membershipId });
}

export async function listUnits(estateId: string) {
	const db = await getDb();
	const rows = await db.select().from(schema.units).where(eq(schema.units.estateId, estateId)).orderBy(schema.units.street, schema.units.number);
	return rows
		.map((u) => ({ ...u, label: unitLabel(u) }))
		.sort((a, b) => a.street.localeCompare(b.street) || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

export { isResidentRole };
