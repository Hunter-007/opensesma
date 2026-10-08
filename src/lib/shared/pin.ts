import { b64urlToBytes, bytesToB64url, utf8 } from './encoding';

/**
 * Guard PINs are hashed with PBKDF2 (WebCrypto, available in Node and every
 * modern browser) so the gate device can check a guard's PIN while offline.
 * Format: "<iterations>$<salt b64url>$<hash b64url>".
 */
// Each guess costs ~0.15 s on a server and ~1 s on a budget phone; with 6 digits
// that makes recovering a PIN from a stolen gate phone take days, not minutes.
const ITERATIONS = 310_000;

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey('raw', utf8.encode(pin) as BufferSource, 'PBKDF2', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		keyMaterial,
		256
	);
	return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await derive(pin, salt, ITERATIONS);
	return `${ITERATIONS}$${bytesToB64url(salt)}$${bytesToB64url(hash)}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
	if (!stored) return false;
	const [iter, salt, hash] = stored.split('$');
	const actual = await derive(pin, b64urlToBytes(salt), Number(iter));
	const expected = b64urlToBytes(hash);
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

/** Guards use a 6-digit PIN; the gate phone also locks after repeated wrong PINs. */
export const PIN_LENGTH = 6;
export const isValidPin = (pin: string) => /^\d{6}$/.test(pin);
