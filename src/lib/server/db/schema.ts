import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import type { DuesStatus, EstateSettings, EventKind, EventMethod, PassType, Role, Schedule } from '../../shared/types';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const estates = pgTable('estates', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	address: text('address').notNull().default(''),
	timeZone: text('time_zone').notNull().default('Africa/Lagos'),
	settings: jsonb('settings').$type<EstateSettings>().notNull(),
	signingPublicKey: text('signing_public_key').notNull(),
	/** AES-GCM encrypted with APP_SECRET. Never leaves the server. */
	signingSecretKeyEnc: text('signing_secret_key_enc').notNull(),
	createdAt: createdAt()
});

export const gates = pgTable('gates', {
	id: text('id').primaryKey(),
	estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	createdAt: createdAt()
});

export const units = pgTable(
	'units',
	{
		id: text('id').primaryKey(),
		estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
		/** Street or block, e.g. "Adeyemi Street" or "Block C". */
		street: text('street').notNull(),
		number: text('number').notNull(),
		active: boolean('active').notNull().default(true),
		duesStatus: text('dues_status').$type<DuesStatus>().notNull().default('unknown'),
		duesNote: text('dues_note').notNull().default(''),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('units_estate_street_number').on(t.estateId, t.street, t.number)]
);

export const users = pgTable('users', {
	id: text('id').primaryKey(),
	phone: text('phone').notNull().unique(),
	name: text('name').notNull().default(''),
	createdAt: createdAt()
});

export const memberships = pgTable(
	'memberships',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
		estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
		unitId: text('unit_id').references(() => units.id, { onDelete: 'set null' }),
		role: text('role').$type<Role>().notNull(),
		status: text('status').$type<'pending' | 'active' | 'disabled'>().notNull().default('pending'),
		/** For join requests: what proof the person says they have (tenancy agreement, etc.). */
		proofNote: text('proof_note').notNull().default(''),
		/** Guards only: PBKDF2 "iterations$salt$hash", verified on the gate device offline. */
		pinHash: text('pin_hash'),
		approvedBy: text('approved_by'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('memberships_user_estate').on(t.userId, t.estateId),
		index('memberships_estate_status').on(t.estateId, t.status)
	]
);

export const invites = pgTable('invites', {
	id: text('id').primaryKey(),
	estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
	unitId: text('unit_id').references(() => units.id, { onDelete: 'cascade' }),
	code: text('code').notNull().unique(),
	phone: text('phone'),
	name: text('name').notNull().default(''),
	role: text('role').$type<Role>().notNull(),
	expiresAt: ts('expires_at').notNull(),
	usedAt: ts('used_at'),
	createdBy: text('created_by'),
	createdAt: createdAt()
});

/**
 * One-time sign-in links an estate manager sends a member on WhatsApp or by
 * text (the MVP has no SMS login codes). Only a hash of the token is stored.
 */
export const loginLinks = pgTable('login_links', {
	/** sha256 of the token in the URL. */
	id: text('id').primaryKey(),
	estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	createdBy: text('created_by'),
	expiresAt: ts('expires_at').notNull(),
	usedAt: ts('used_at'),
	createdAt: createdAt()
});

export const otps = pgTable(
	'otps',
	{
		id: text('id').primaryKey(),
		phone: text('phone').notNull(),
		codeHash: text('code_hash').notNull(),
		expiresAt: ts('expires_at').notNull(),
		attempts: integer('attempts').notNull().default(0),
		consumedAt: ts('consumed_at'),
		createdAt: createdAt()
	},
	(t) => [index('otps_phone_created').on(t.phone, t.createdAt)]
);

export const sessions = pgTable('sessions', {
	/** sha256 of the cookie token; the raw token is never stored. */
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	activeEstateId: text('active_estate_id'),
	expiresAt: ts('expires_at').notNull(),
	createdAt: createdAt()
});

export const staffProfiles = pgTable('staff_profiles', {
	id: text('id').primaryKey(),
	estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
	unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	phone: text('phone'),
	/** Driver, nanny, cleaner, gardener… */
	role: text('role').notNull(),
	idType: text('id_type').notNull().default(''),
	idNumber: text('id_number').notNull().default(''),
	active: boolean('active').notNull().default(true),
	createdAt: createdAt()
});

export const passes = pgTable(
	'passes',
	{
		id: text('id').primaryKey(),
		estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
		unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
		createdBy: text('created_by').notNull(),
		type: text('type').$type<PassType>().notNull(),
		visitorName: text('visitor_name').notNull().default(''),
		visitorPhone: text('visitor_phone'),
		purpose: text('purpose').notNull().default(''),
		code: text('code').notNull(),
		token: text('token').notNull(),
		validFrom: ts('valid_from').notNull(),
		validTo: ts('valid_to'),
		schedule: jsonb('schedule').$type<Schedule>(),
		maxEntries: integer('max_entries').notNull().default(1),
		entriesUsed: integer('entries_used').notNull().default(0),
		status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
		revokedAt: ts('revoked_at'),
		staffProfileId: text('staff_profile_id').references(() => staffProfiles.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: ts('updated_at').notNull().defaultNow()
	},
	(t) => [
		// A 6-digit code is unique only among ACTIVE passes in one estate, so codes recycle.
		uniqueIndex('passes_active_code').on(t.estateId, t.code).where(sql`${t.status} = 'active'`),
		index('passes_estate_updated').on(t.estateId, t.updatedAt),
		index('passes_unit').on(t.unitId, t.status)
	]
);

export const devices = pgTable('devices', {
	id: text('id').primaryKey(),
	estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
	gateId: text('gate_id').notNull().references(() => gates.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	enrollCode: text('enroll_code').unique(),
	enrollExpiresAt: ts('enroll_expires_at'),
	tokenHash: text('token_hash').unique(),
	/** Tokens rotate daily; the previous one stays valid briefly in case the reply carrying the new one was lost. */
	tokenIssuedAt: ts('token_issued_at'),
	prevTokenHash: text('prev_token_hash'),
	prevTokenValidUntil: ts('prev_token_valid_until'),
	enrolledAt: ts('enrolled_at'),
	revokedAt: ts('revoked_at'),
	lastSyncAt: ts('last_sync_at'),
	createdBy: text('created_by'),
	createdAt: createdAt()
});

export const accessEvents = pgTable(
	'access_events',
	{
		/** UUID v7 generated on the device, so offline retries are idempotent. */
		id: text('id').primaryKey(),
		estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
		gateId: text('gate_id').notNull(),
		deviceId: text('device_id').notNull(),
		guardUserId: text('guard_user_id'),
		guardName: text('guard_name').notNull().default(''),
		passId: text('pass_id'),
		unitId: text('unit_id'),
		passType: text('pass_type').$type<PassType>(),
		kind: text('kind').$type<EventKind>().notNull(),
		method: text('method').$type<EventMethod>().notNull(),
		visitorName: text('visitor_name').notNull().default(''),
		reason: text('reason').notNull().default(''),
		offline: boolean('offline').notNull().default(false),
		/** Set on sync when two offline gates admitted the same limited pass. */
		conflict: boolean('conflict').notNull().default(false),
		/** Set on upload when the server's own check disagrees with the gate (e.g. 'revoked', 'clock_skew'). */
		flag: text('flag'),
		deviceTs: ts('device_ts').notNull(),
		serverTs: ts('server_ts').notNull().defaultNow()
	},
	(t) => [
		index('events_estate_time').on(t.estateId, t.deviceTs),
		index('events_pass').on(t.passId),
		index('events_unit').on(t.unitId, t.deviceTs)
	]
);

export const walkinRequests = pgTable(
	'walkin_requests',
	{
		id: text('id').primaryKey(),
		estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
		unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
		gateId: text('gate_id').notNull(),
		deviceId: text('device_id').notNull(),
		guardName: text('guard_name').notNull().default(''),
		visitorName: text('visitor_name').notNull(),
		visitorPhone: text('visitor_phone'),
		purpose: text('purpose').notNull().default(''),
		status: text('status').$type<'pending' | 'approved' | 'denied' | 'expired'>().notNull().default('pending'),
		/** Short code residents can reply with by SMS link. */
		replyToken: text('reply_token').notNull().unique(),
		decidedBy: text('decided_by'),
		decidedByName: text('decided_by_name'),
		decidedAt: ts('decided_at'),
		note: text('note').notNull().default(''),
		smsFallbackAt: ts('sms_fallback_at'),
		passId: text('pass_id'),
		createdAt: createdAt()
	},
	(t) => [index('walkins_unit_status').on(t.unitId, t.status)]
);

export const bans = pgTable('bans', {
	id: text('id').primaryKey(),
	estateId: text('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' }),
	name: text('name'),
	phone: text('phone'),
	reason: text('reason').notNull(),
	addedBy: text('added_by'),
	expiresAt: ts('expires_at'),
	removedAt: ts('removed_at'),
	createdAt: createdAt(),
	updatedAt: ts('updated_at').notNull().defaultNow()
});

export const pushSubscriptions = pgTable('push_subscriptions', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	createdAt: createdAt()
});

export const auditLogs = pgTable(
	'audit_logs',
	{
		id: serial('id').primaryKey(),
		estateId: text('estate_id'),
		actorUserId: text('actor_user_id'),
		action: text('action').notNull(),
		entity: text('entity').notNull(),
		entityId: text('entity_id'),
		data: jsonb('data').$type<Record<string, unknown>>(),
		createdAt: createdAt()
	},
	(t) => [index('audit_estate_time').on(t.estateId, t.createdAt)]
);

export const rateLimits = pgTable('rate_limits', {
	key: text('key').primaryKey(),
	count: integer('count').notNull().default(0),
	windowStart: ts('window_start').notNull()
});
