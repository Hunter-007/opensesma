export const PASS_TYPES = ['guest', 'multiday', 'staff', 'delivery', 'artisan', 'event'] as const;
export type PassType = (typeof PASS_TYPES)[number];

export const PASS_TYPE_LABEL: Record<PassType, string> = {
	guest: 'Guest',
	multiday: 'Multi-day guest',
	staff: 'Staff',
	delivery: 'Delivery',
	artisan: 'Artisan / service',
	event: 'Event / group'
};

/** Single-letter codes keep QR payloads small. */
export const PASS_TYPE_CODE: Record<PassType, string> = {
	guest: 'g',
	multiday: 'm',
	staff: 's',
	delivery: 'd',
	artisan: 'a',
	event: 'e'
};
export const PASS_TYPE_FROM_CODE = Object.fromEntries(
	Object.entries(PASS_TYPE_CODE).map(([k, v]) => [v, k])
) as Record<string, PassType>;

export const ROLES = ['estate_admin', 'security_officer', 'guard', 'resident_primary', 'resident_sub'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
	estate_admin: 'Estate manager',
	security_officer: 'Security officer',
	guard: 'Guard',
	resident_primary: 'Resident (primary)',
	resident_sub: 'Household member'
};

export const isAdminRole = (r: Role) => r === 'estate_admin' || r === 'security_officer';
export const isResidentRole = (r: Role) => r === 'resident_primary' || r === 'resident_sub';

/** Recurring schedule. days: 0=Sun..6=Sat. start/end are "HH:MM" in estate local time; end < start means overnight. */
export interface Schedule {
	days: number[];
	start: string;
	end: string;
}

export type LevyRule = 'off' | 'warn' | 'restrict';
export type DuesStatus = 'paid' | 'owing' | 'unknown';

export interface EstateSettings {
	levyRule: LevyRule;
	maxSubResidents: number;
	maxActivePassesPerUnit: number;
	guestWindowHours: number;
	deliveryWindowHours: number;
	staleSyncHours: number;
	disabledPassTypes: PassType[];
	directionsNote: string;
	retentionMonths: number;
}

export const DEFAULT_SETTINGS: EstateSettings = {
	levyRule: 'warn',
	maxSubResidents: 6,
	maxActivePassesPerUnit: 50,
	guestWindowHours: 12,
	deliveryWindowHours: 2,
	staleSyncHours: 6,
	disabledPassTypes: [],
	directionsNote: '',
	retentionMonths: 12
};

/**
 * Daily entry caps for personal passes that last more than one visit. They stop
 * one forwarded code from admitting a stream of people. Guests and deliveries
 * are single-entry; events have their own total capacity.
 */
export const PER_DAY_CAP: Partial<Record<PassType, number>> = { staff: 4, artisan: 4, multiday: 6 };

/** Pass types a household that owes dues can still create under the "restrict" levy rule. */
export const ESSENTIAL_PASS_TYPES: PassType[] = ['guest', 'staff', 'delivery', 'artisan'];

export type EventKind = 'entry' | 'exit' | 'deny' | 'override';
export type EventMethod = 'qr' | 'code' | 'walkin' | 'override' | 'manual';

export const OVERRIDE_REASONS = [
	'Official / police',
	'Emergency / medical',
	'Resident vouched in person',
	'Other'
] as const;

export const DENY_MESSAGES: Record<string, string> = {
	bad_signature: 'Fake or damaged pass',
	wrong_estate: 'Pass is for another estate',
	revoked: 'Pass was cancelled by the resident',
	not_yet: 'Pass is not active yet',
	expired: 'Pass has expired',
	outside_hours: 'Outside allowed hours',
	used_up: 'Pass already used',
	daily_limit: 'Pass has reached its entries for today',
	unknown_code: 'Code not recognised',
	banned: 'On the estate ban list — refer to supervisor',
	unit_inactive: 'Household is no longer active',
	locked: 'Keypad locked after too many wrong codes',
	clock_skew: 'Gate phone clock was wrong',
	unknown_pass: 'Pass not found',
	not_ready: 'Gate phone not set up'
};

/** Human wording for a stored deny/override reason (deny reasons are stored as codes). */
export const reasonText = (r: string) => DENY_MESSAGES[r] ?? r;
