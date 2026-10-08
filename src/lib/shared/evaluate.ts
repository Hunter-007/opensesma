import type { PassClaims } from './passToken';
import type { Schedule } from './types';

/**
 * The single decision function used by BOTH the server and the offline guard
 * device. Keeping it shared guarantees the gate and the server never disagree.
 */
export type Decision =
	| { allow: true; warnings: string[] }
	| {
			allow: false;
			reason: 'wrong_estate' | 'revoked' | 'not_yet' | 'expired' | 'outside_hours' | 'used_up' | 'banned' | 'unit_inactive';
	  };

export interface EvaluateContext {
	now: Date;
	estateId: string;
	timeZone: string;
	entriesUsed: number;
	revoked: boolean;
	banned?: boolean;
	unitActive?: boolean;
	/** Household owes dues and the estate levy rule is "warn" or "restrict". */
	duesOwingWarning?: boolean;
}

export function localParts(date: Date, timeZone: string): { day: number; minutes: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
	return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export const toMinutes = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
};

export function withinSchedule(schedule: Schedule, date: Date, timeZone: string): boolean {
	const { day, minutes } = localParts(date, timeZone);
	const start = toMinutes(schedule.start);
	const end = toMinutes(schedule.end);
	if (start === end) return schedule.days.includes(day); // all day
	if (start < end) return schedule.days.includes(day) && minutes >= start && minutes < end;
	// Overnight window, e.g. night watchman 20:00–06:00: the early-morning half
	// belongs to the previous day's shift.
	const prev = (day + 6) % 7;
	return (schedule.days.includes(day) && minutes >= start) || (schedule.days.includes(prev) && minutes < end);
}

export function evaluatePass(claims: PassClaims, ctx: EvaluateContext): Decision {
	const nowS = Math.floor(ctx.now.getTime() / 1000);
	if (claims.estateId !== ctx.estateId) return { allow: false, reason: 'wrong_estate' };
	if (ctx.revoked) return { allow: false, reason: 'revoked' };
	if (ctx.unitActive === false) return { allow: false, reason: 'unit_inactive' };
	if (ctx.banned) return { allow: false, reason: 'banned' };
	if (nowS < claims.validFrom) return { allow: false, reason: 'not_yet' };
	if (claims.validTo && nowS >= claims.validTo) return { allow: false, reason: 'expired' };
	if (claims.schedule && !withinSchedule(claims.schedule, ctx.now, ctx.timeZone))
		return { allow: false, reason: 'outside_hours' };
	if (claims.maxEntries > 0 && ctx.entriesUsed >= claims.maxEntries) return { allow: false, reason: 'used_up' };

	const warnings: string[] = [];
	if (ctx.duesOwingWarning) warnings.push('Household is owing estate dues');
	if (claims.maxEntries > 1) warnings.push(`${claims.maxEntries - ctx.entriesUsed} of ${claims.maxEntries} entries left`);
	return { allow: true, warnings };
}

/** Ban-list match: exact normalised phone, or name match ignoring case/spacing/punctuation. */
export function normaliseName(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchesBan(
	visitor: { name?: string | null; phone?: string | null },
	bans: { name?: string | null; phone?: string | null }[]
): boolean {
	const n = visitor.name ? normaliseName(visitor.name) : '';
	return bans.some(
		(b) =>
			(!!b.phone && !!visitor.phone && b.phone === visitor.phone) ||
			(!!b.name && n.length > 2 && normaliseName(b.name) === n)
	);
}
