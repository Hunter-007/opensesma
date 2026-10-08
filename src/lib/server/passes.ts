import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { estateSecretKey, getEstate } from './estates';
import { sendSms } from './sms';
import { AppError, audit, unitLabel } from './util';
import { config } from './config';
import { signPass, type PassClaims } from '../shared/passToken';
import { randomId, sixDigitCode } from '../shared/encoding';
import { normalisePhone } from '../shared/phone';
import { formatDateTime, formatSchedule } from '../shared/format';
import { ESSENTIAL_PASS_TYPES, PASS_TYPE_LABEL, type PassType, type Schedule } from '../shared/types';

export interface CreatePassInput {
	type: PassType;
	visitorName?: string;
	visitorPhone?: string;
	purpose?: string;
	/** ISO strings or Dates; defaults depend on type. */
	validFrom?: Date;
	validTo?: Date | null;
	schedule?: Schedule | null;
	maxEntries?: number;
	staffProfileId?: string | null;
	/** Text the visitor an SMS with the code (costs an SMS credit). */
	sendSms?: boolean;
}

export interface Actor {
	userId: string;
	estateId: string;
	unitId: string;
}

const HOUR = 3_600_000;

function validateSchedule(s: Schedule | null | undefined): Schedule | null {
	if (!s) return null;
	const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
	const days = [...new Set(s.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort();
	if (!days.length) throw new AppError('Choose at least one day');
	if (!hhmm.test(s.start) || !hhmm.test(s.end)) throw new AppError('Times must look like 06:00');
	return { days, start: s.start, end: s.end };
}

/** Applies per-type defaults and rules (PRD 2 pass type table). */
export function resolvePassShape(input: CreatePassInput, settings: { guestWindowHours: number; deliveryWindowHours: number }, now = new Date()) {
	const name = (input.visitorName ?? '').trim().slice(0, 60);
	const from = input.validFrom ?? now;
	let to: Date | null = input.validTo ?? null;
	let maxEntries = input.maxEntries ?? 1;
	let schedule: Schedule | null = null;

	switch (input.type) {
		case 'guest':
			if (!name) throw new AppError("Enter your guest's name");
			to = to ?? new Date(from.getTime() + settings.guestWindowHours * HOUR);
			maxEntries = 1;
			break;
		case 'multiday':
			if (!name) throw new AppError("Enter your guest's name");
			if (!to) throw new AppError('Choose the last day of the visit');
			maxEntries = 0;
			break;
		case 'staff':
			if (!name) throw new AppError("Enter the staff member's name");
			schedule = validateSchedule(input.schedule ?? { days: [1, 2, 3, 4, 5, 6], start: '06:00', end: '20:00' });
			to = input.validTo ?? null;
			maxEntries = 0;
			break;
		case 'delivery':
			to = to ?? new Date(from.getTime() + settings.deliveryWindowHours * HOUR);
			maxEntries = 1;
			break;
		case 'artisan':
			if (!name) throw new AppError("Enter the artisan's name");
			if (!(input.purpose ?? '').trim()) throw new AppError('Say what the artisan is coming to do');
			to = to ?? new Date(from.getTime() + 10 * HOUR);
			maxEntries = 0;
			break;
		case 'event':
			if (!to) throw new AppError('Choose when the event ends');
			if (!maxEntries || maxEntries < 1 || maxEntries > 1000) throw new AppError('Set how many guests can enter (1–1000)');
			break;
		default:
			throw new AppError('Unknown pass type');
	}
	if (to && to <= from) throw new AppError('The end time must be after the start time');
	if (to && to.getTime() - from.getTime() > 31 * 24 * HOUR && input.type !== 'staff')
		throw new AppError('Visitor passes can last at most 31 days. Use a staff pass for regular helpers');
	return { name, from, to, maxEntries, schedule };
}

async function uniqueCode(estateId: string): Promise<string> {
	const db = await getDb();
	for (let i = 0; i < 20; i++) {
		const code = sixDigitCode();
		const [hit] = await db
			.select({ id: schema.passes.id })
			.from(schema.passes)
			.where(and(eq(schema.passes.estateId, estateId), eq(schema.passes.code, code), eq(schema.passes.status, 'active')))
			.limit(1);
		if (!hit) return code;
	}
	throw new AppError('Could not allocate a code, please try again', 503);
}

export async function createPass(actor: Actor, input: CreatePassInput) {
	const db = await getDb();
	const estate = await getEstate(actor.estateId);
	const [unit] = await db.select().from(schema.units).where(and(eq(schema.units.id, actor.unitId), eq(schema.units.estateId, actor.estateId))).limit(1);
	if (!unit || !unit.active) throw new AppError('Your household is not active on this estate', 403, 'unit_inactive');
	if (estate.settings.disabledPassTypes.includes(input.type)) throw new AppError(`${PASS_TYPE_LABEL[input.type]} passes are turned off by your estate`, 403);

	if (estate.settings.levyRule === 'restrict' && unit.duesStatus === 'owing' && !ESSENTIAL_PASS_TYPES.includes(input.type))
		throw new AppError(
			`Your household has outstanding estate dues, so ${PASS_TYPE_LABEL[input.type].toLowerCase()} passes are paused. Guests, staff, deliveries and artisans still work. Contact the estate manager to settle.`,
			403,
			'levy_restricted'
		);

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(schema.passes)
		.where(
			and(
				eq(schema.passes.unitId, unit.id),
				eq(schema.passes.status, 'active'),
				or(isNull(schema.passes.validTo), gt(schema.passes.validTo, new Date()))
			)
		);
	if (count >= estate.settings.maxActivePassesPerUnit)
		throw new AppError(`Your household already has ${count} active passes. Cancel some before creating more.`, 429);

	const shape = resolvePassShape(input, estate.settings);
	const visitorPhone = input.visitorPhone ? normalisePhone(input.visitorPhone) : null;
	if (input.visitorPhone && !visitorPhone) throw new AppError("The visitor's phone number doesn't look right");

	const id = randomId(10);
	const code = await uniqueCode(estate.id);
	const claims: PassClaims = {
		id,
		estateId: estate.id,
		unitId: unit.id,
		type: input.type,
		name: shape.name,
		validFrom: Math.floor(shape.from.getTime() / 1000),
		validTo: shape.to ? Math.floor(shape.to.getTime() / 1000) : 0,
		maxEntries: shape.maxEntries,
		schedule: shape.schedule,
		iat: Math.floor(Date.now() / 1000)
	};
	const token = signPass(claims, estateSecretKey(estate));

	const [pass] = await db
		.insert(schema.passes)
		.values({
			id,
			estateId: estate.id,
			unitId: unit.id,
			createdBy: actor.userId,
			type: input.type,
			visitorName: shape.name,
			visitorPhone,
			purpose: (input.purpose ?? '').trim().slice(0, 120),
			code,
			token,
			validFrom: shape.from,
			validTo: shape.to,
			schedule: shape.schedule,
			maxEntries: shape.maxEntries,
			staffProfileId: input.staffProfileId ?? null
		})
		.returning();

	await audit(db, { estateId: estate.id, actorUserId: actor.userId, action: 'pass.create', entity: 'pass', entityId: id, data: { type: input.type } });

	if (input.sendSms && visitorPhone) {
		await sendSms(visitorPhone, shareMessage(pass, estate, unitLabel(unit), { short: true }));
	}
	return pass;
}

export async function revokePass(estateId: string, actorUserId: string, passId: string, opts: { unitId?: string } = {}) {
	const db = await getDb();
	const conds = [eq(schema.passes.id, passId), eq(schema.passes.estateId, estateId)];
	if (opts.unitId) conds.push(eq(schema.passes.unitId, opts.unitId));
	const [pass] = await db
		.update(schema.passes)
		.set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
		.where(and(...conds))
		.returning();
	if (!pass) throw new AppError('Pass not found', 404, 'not_found');
	await audit(db, { estateId, actorUserId, action: 'pass.revoke', entity: 'pass', entityId: passId });
	return pass;
}

export const shareUrl = (token: string) => `${config.publicUrl}/p/${token}`;

type PassLike = Pick<typeof schema.passes.$inferSelect, 'type' | 'visitorName' | 'code' | 'token' | 'validFrom' | 'validTo' | 'schedule' | 'maxEntries'>;

/** The WhatsApp/SMS message. Plain text so it works everywhere, even on feature phones. */
export function shareMessage(
	pass: PassLike,
	estate: { name: string; address: string; timeZone: string; settings: { directionsNote: string } },
	unit: string,
	opts: { short?: boolean; hostName?: string } = {}
): string {
	const when = pass.schedule
		? formatSchedule(pass.schedule)
		: pass.validTo
			? `${formatDateTime(pass.validFrom, estate.timeZone)} – ${formatDateTime(pass.validTo, estate.timeZone)}`
			: `from ${formatDateTime(pass.validFrom, estate.timeZone)}`;
	if (opts.short) {
		return `${estate.name} gate pass for ${unit}. Code: ${pass.code}. Valid ${when}. Show code or QR at the gate: ${shareUrl(pass.token)}`;
	}
	const lines = [
		pass.visitorName ? `Hi ${pass.visitorName.split(' ')[0]},` : 'Hello,',
		`${opts.hostName ? opts.hostName + ' has' : "You've been"} invited you to ${unit}, ${estate.name}.`,
		'',
		`Gate code: *${pass.code}*`,
		`Valid: ${when}`,
		pass.type === 'event' && pass.maxEntries ? `Group pass for up to ${pass.maxEntries} people` : '',
		'',
		`Show this code or your QR to the guard: ${shareUrl(pass.token)}`,
		estate.address ? `Address: ${estate.address}` : '',
		estate.settings.directionsNote ? `Directions: ${estate.settings.directionsNote}` : ''
	];
	return lines.filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i !== arr.length - 1)).join('\n').trim();
}

export async function listUnitPasses(estateId: string, unitId: string, opts: { includeInactive?: boolean } = {}) {
	const db = await getDb();
	const now = new Date();
	const rows = await db
		.select()
		.from(schema.passes)
		.where(and(eq(schema.passes.estateId, estateId), eq(schema.passes.unitId, unitId)))
		.orderBy(desc(schema.passes.createdAt))
		.limit(200);
	return rows.map((p) => ({ ...p, live: isLive(p, now) })).filter((p) => opts.includeInactive || p.live);
}

export function isLive(p: { status: string; validTo: Date | null; maxEntries: number; entriesUsed: number }, now = new Date()) {
	return p.status === 'active' && (!p.validTo || p.validTo > now) && (p.maxEntries === 0 || p.entriesUsed < p.maxEntries);
}

export async function getPassForUnit(estateId: string, unitId: string, passId: string) {
	const db = await getDb();
	const [pass] = await db
		.select()
		.from(schema.passes)
		.where(and(eq(schema.passes.id, passId), eq(schema.passes.estateId, estateId), eq(schema.passes.unitId, unitId)))
		.limit(1);
	if (!pass) throw new AppError('Pass not found', 404, 'not_found');
	const events = await db
		.select()
		.from(schema.accessEvents)
		.where(eq(schema.accessEvents.passId, passId))
		.orderBy(desc(schema.accessEvents.deviceTs))
		.limit(50);
	return { pass, events, live: isLive(pass) };
}

// ---------------------------------------------------------------- staff profiles

export async function addStaffProfile(actor: Actor, input: { name: string; phone?: string; role: string; idType?: string; idNumber?: string; schedule: Schedule }) {
	const db = await getDb();
	const name = input.name.trim();
	if (!name) throw new AppError('Enter a name');
	if (!input.role.trim()) throw new AppError('Choose a role, e.g. Driver');
	const phone = input.phone ? normalisePhone(input.phone) : null;
	if (input.phone && !phone) throw new AppError('Phone number looks wrong');
	const [profile] = await db
		.insert(schema.staffProfiles)
		.values({
			id: randomId(),
			estateId: actor.estateId,
			unitId: actor.unitId,
			name,
			phone,
			role: input.role.trim(),
			idType: input.idType?.trim() ?? '',
			idNumber: input.idNumber?.trim() ?? ''
		})
		.returning();
	const pass = await createPass(actor, { type: 'staff', visitorName: name, visitorPhone: phone ?? undefined, purpose: profile.role, schedule: input.schedule, staffProfileId: profile.id });
	return { profile, pass };
}

export async function removeStaffProfile(actor: Actor, profileId: string) {
	const db = await getDb();
	const [p] = await db
		.update(schema.staffProfiles)
		.set({ active: false })
		.where(and(eq(schema.staffProfiles.id, profileId), eq(schema.staffProfiles.unitId, actor.unitId)))
		.returning();
	if (!p) throw new AppError('Staff member not found', 404);
	await db
		.update(schema.passes)
		.set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.passes.staffProfileId, profileId), eq(schema.passes.status, 'active')));
	await audit(db, { estateId: actor.estateId, actorUserId: actor.userId, action: 'staff_profile.remove', entity: 'staff_profile', entityId: profileId });
}
