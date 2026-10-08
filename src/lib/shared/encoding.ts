// Isomorphic helpers (browser + Node 20+). No Node-only APIs here.

export function bytesToB64url(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string): Uint8Array {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export const utf8 = {
	encode: (s: string) => new TextEncoder().encode(s),
	decode: (b: Uint8Array) => new TextDecoder().decode(b)
};

/** Crockford-ish alphabet without look-alikes (0/O, 1/I/L) — safe to read aloud or type. */
const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function randomId(length = 12): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = '';
	for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
	return out;
}

/** Uppercase human code for invites and device enrolment, e.g. "K7QM-3XPA". */
export function humanCode(length = 8): string {
	const raw = randomId(length).toUpperCase();
	return length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export function normaliseHumanCode(input: string): string {
	const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
	return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

/** Uniform random 6-digit numeric code (100000–999999), no modulo bias. */
export function sixDigitCode(): string {
	const buf = new Uint32Array(1);
	const limit = Math.floor(0xffffffff / 900000) * 900000;
	for (;;) {
		crypto.getRandomValues(buf);
		if (buf[0] < limit) return String(100000 + (buf[0] % 900000));
	}
}

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', utf8.encode(input) as BufferSource);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
