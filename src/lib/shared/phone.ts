/**
 * Normalise a phone number to E.164. Defaults to Nigeria (+234):
 *   08031234567  -> +2348031234567
 *   8031234567   -> +2348031234567
 *   2348031234567 -> +2348031234567
 *   +44 7700 900123 -> +447700900123
 * Returns null if it can't be a valid number.
 */
export function normalisePhone(input: string, defaultCountry = '234'): string | null {
	if (!input) return null;
	let s = input.trim().replace(/[\s\-().]/g, '');
	if (s.startsWith('00')) s = '+' + s.slice(2);
	if (s.startsWith('+')) {
		const digits = s.slice(1);
		return /^\d{8,15}$/.test(digits) ? '+' + digits : null;
	}
	if (!/^\d+$/.test(s)) return null;
	if (s.startsWith(defaultCountry) && s.length >= defaultCountry.length + 8) return '+' + s;
	if (s.startsWith('0')) s = s.slice(1);
	// Nigerian mobile numbers are 10 digits after the leading 0.
	if (defaultCountry === '234' && s.length !== 10) return null;
	return '+' + defaultCountry + s;
}

/** +2348031234567 -> 0803 123 4567 (local style for Nigerian numbers). */
export function formatPhone(e164: string | null | undefined): string {
	if (!e164) return '';
	if (e164.startsWith('+234') && e164.length === 14) {
		const local = '0' + e164.slice(4);
		return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
	}
	return e164;
}
