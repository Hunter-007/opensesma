import { describe, expect, it } from 'vitest';
import { extractToken, generateSigningKey, peekPass, signPass, verifyPass, type PassClaims } from '../src/lib/shared/passToken';
import { evaluatePass, matchesBan, withinSchedule } from '../src/lib/shared/evaluate';
import { normalisePhone, formatPhone } from '../src/lib/shared/phone';
import { sixDigitCode, normaliseHumanCode, humanCode } from '../src/lib/shared/encoding';

const TZ = 'Africa/Lagos';
// 2026-10-12 is a Monday. Lagos is UTC+1, so 09:00 UTC = 10:00 local.
const MON_10AM = new Date('2026-10-12T09:00:00Z');
const s = (d: Date) => Math.floor(d.getTime() / 1000);

const base: PassClaims = {
	id: 'p123',
	estateId: 'est1',
	unitId: 'u1',
	type: 'guest',
	name: 'Chidi Okafor',
	validFrom: s(MON_10AM) - 3600,
	validTo: s(MON_10AM) + 3600,
	maxEntries: 1,
	schedule: null,
	iat: s(MON_10AM) - 3600
};
const ctx = { now: MON_10AM, estateId: 'est1', timeZone: TZ, entriesUsed: 0, revoked: false };

describe('pass tokens', () => {
	const keys = generateSigningKey();

	it('round-trips and verifies offline with only the public key', () => {
		const token = signPass(base, keys.secretKey);
		const r = verifyPass(token, keys.publicKey);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.claims).toEqual(base);
	});

	it('rejects a tampered payload', () => {
		const token = signPass(base, keys.secretKey);
		const [payload, sig] = token.split('.');
		const forged = signPass({ ...base, maxEntries: 0 }, generateSigningKey().secretKey).split('.')[0];
		expect(verifyPass(`${forged}.${sig}`, keys.publicKey).ok).toBe(false);
		expect(verifyPass(`${payload}.${sig.slice(0, -2)}AA`, keys.publicKey).ok).toBe(false);
		expect(verifyPass('garbage', keys.publicKey).ok).toBe(false);
	});

	it('rejects a token signed by another estate key', () => {
		const token = signPass(base, generateSigningKey().secretKey);
		expect(verifyPass(token, keys.publicKey).ok).toBe(false);
	});

	it('keeps tokens short enough for a low-density QR', () => {
		const token = signPass({ ...base, schedule: { days: [1, 2, 3, 4, 5, 6], start: '06:00', end: '20:00' } }, keys.secretKey);
		expect(token.length).toBeLessThan(330);
		expect(peekPass(token)?.schedule?.days).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('extracts tokens from share URLs and raw scans', () => {
		const token = signPass(base, keys.secretKey);
		expect(extractToken(`https://opensesma.app/p/${token}`)).toBe(token);
		expect(extractToken(`https://opensesma.app/p/${token}?utm=wa`)).toBe(token);
		expect(extractToken(token)).toBe(token);
		expect(extractToken('https://example.com/hello')).toBeNull();
	});
});

describe('evaluatePass', () => {
	it('allows a valid one-time guest', () => {
		expect(evaluatePass(base, ctx).allow).toBe(true);
	});

	it.each([
		['wrong_estate', { ...ctx, estateId: 'other' }, base],
		['revoked', { ...ctx, revoked: true }, base],
		['not_yet', ctx, { ...base, validFrom: s(MON_10AM) + 60 }],
		['expired', ctx, { ...base, validTo: s(MON_10AM) }],
		['used_up', { ...ctx, entriesUsed: 1 }, base],
		['banned', { ...ctx, banned: true }, base],
		['unit_inactive', { ...ctx, unitActive: false }, base]
	])('denies: %s', (reason, c, claims) => {
		const d = evaluatePass(claims as PassClaims, c);
		expect(d.allow).toBe(false);
		if (!d.allow) expect(d.reason).toBe(reason);
	});

	it('enforces event capacity (entry 41 of 40 is refused)', () => {
		const ev = { ...base, type: 'event' as const, maxEntries: 40 };
		expect(evaluatePass(ev, { ...ctx, entriesUsed: 39 }).allow).toBe(true);
		expect(evaluatePass(ev, { ...ctx, entriesUsed: 40 }).allow).toBe(false);
	});

	it('treats validTo=0 and maxEntries=0 as unlimited', () => {
		const staff = { ...base, type: 'staff' as const, validTo: 0, maxEntries: 0 };
		expect(evaluatePass(staff, { ...ctx, entriesUsed: 500 }).allow).toBe(true);
	});

	it('surfaces a dues warning without blocking', () => {
		const d = evaluatePass(base, { ...ctx, duesOwingWarning: true });
		expect(d.allow).toBe(true);
		if (d.allow) expect(d.warnings).toContain('Household is owing estate dues');
	});
});

describe('schedules (estate local time)', () => {
	const weekdays = { days: [1, 2, 3, 4, 5, 6], start: '06:00', end: '20:00' };

	it('allows a Mon–Sat 06:00–20:00 driver at 10:00 Monday', () => {
		expect(withinSchedule(weekdays, MON_10AM, TZ)).toBe(true);
	});
	it('uses Lagos time, not UTC (05:30 UTC = 06:30 local is inside)', () => {
		expect(withinSchedule(weekdays, new Date('2026-10-12T05:30:00Z'), TZ)).toBe(true);
		expect(withinSchedule(weekdays, new Date('2026-10-12T04:30:00Z'), TZ)).toBe(false);
	});
	it('refuses on Sunday', () => {
		expect(withinSchedule(weekdays, new Date('2026-10-11T09:00:00Z'), TZ)).toBe(false);
	});
	it('handles an overnight watchman shift 20:00–06:00 starting Friday', () => {
		const night = { days: [5], start: '20:00', end: '06:00' };
		expect(withinSchedule(night, new Date('2026-10-16T21:00:00Z'), TZ)).toBe(true); // Fri 22:00
		expect(withinSchedule(night, new Date('2026-10-17T03:00:00Z'), TZ)).toBe(true); // Sat 04:00
		expect(withinSchedule(night, new Date('2026-10-17T07:00:00Z'), TZ)).toBe(false); // Sat 08:00
		expect(withinSchedule(night, new Date('2026-10-17T21:00:00Z'), TZ)).toBe(false); // Sat 22:00
	});
	it('denies a staff pass outside hours with outside_hours', () => {
		const staff = { ...base, type: 'staff' as const, validTo: 0, maxEntries: 0, schedule: weekdays };
		const d = evaluatePass(staff, { ...ctx, now: new Date('2026-10-12T20:30:00Z') });
		expect(d.allow).toBe(false);
		if (!d.allow) expect(d.reason).toBe('outside_hours');
	});
});

describe('helpers', () => {
	it('normalises Nigerian phone numbers', () => {
		expect(normalisePhone('0803 123 4567')).toBe('+2348031234567');
		expect(normalisePhone('8031234567')).toBe('+2348031234567');
		expect(normalisePhone('2348031234567')).toBe('+2348031234567');
		expect(normalisePhone('+44 7700 900123')).toBe('+447700900123');
		expect(normalisePhone('12345')).toBeNull();
		expect(formatPhone('+2348031234567')).toBe('0803 123 4567');
	});
	it('generates 6-digit codes in range', () => {
		for (let i = 0; i < 1000; i++) expect(sixDigitCode()).toMatch(/^[1-9]\d{5}$/);
	});
	it('normalises typed human codes', () => {
		const c = humanCode();
		expect(normaliseHumanCode(c.toLowerCase().replace('-', ' '))).toBe(c);
	});
	it('matches ban list by phone or normalised name', () => {
		const bans = [{ name: 'Musa  Ibrahim', phone: null }, { name: null, phone: '+2348000000000' }];
		expect(matchesBan({ name: 'musa ibrahim' }, bans)).toBe(true);
		expect(matchesBan({ name: 'Ade', phone: '+2348000000000' }, bans)).toBe(true);
		expect(matchesBan({ name: 'Ada Obi', phone: '+2348111111111' }, bans)).toBe(false);
	});
});
