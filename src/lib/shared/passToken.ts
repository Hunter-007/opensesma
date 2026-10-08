import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlToBytes, bytesToB64url, utf8 } from './encoding';
import { PASS_TYPE_CODE, PASS_TYPE_FROM_CODE, type PassType, type Schedule } from './types';

/**
 * A pass token is `<payload>.<signature>`, both base64url.
 * The payload is compact JSON signed with the estate's Ed25519 key, so a guard
 * device holding only the estate PUBLIC key can verify it with no network.
 */
export interface PassClaims {
	id: string;
	estateId: string;
	unitId: string;
	type: PassType;
	/** Visitor display name (may be empty for deliveries). */
	name: string;
	/** Unix seconds. */
	validFrom: number;
	/** Unix seconds; 0 = no end (recurring staff). */
	validTo: number;
	/** 0 = unlimited. */
	maxEntries: number;
	schedule: Schedule | null;
	/** Issued-at, unix seconds. Edits re-issue with a new iat. */
	iat: number;
}

interface WireClaims {
	v: 1;
	i: string;
	e: string;
	u: string;
	t: string;
	n: string;
	f: number;
	x: number;
	m: number;
	s?: [number[], string, string];
	a: number;
}

const toWire = (c: PassClaims): WireClaims => ({
	v: 1,
	i: c.id,
	e: c.estateId,
	u: c.unitId,
	t: PASS_TYPE_CODE[c.type],
	n: c.name,
	f: c.validFrom,
	x: c.validTo,
	m: c.maxEntries,
	...(c.schedule ? { s: [c.schedule.days, c.schedule.start, c.schedule.end] } : {}),
	a: c.iat
});

const fromWire = (w: WireClaims): PassClaims => {
	const type = PASS_TYPE_FROM_CODE[w.t];
	if (w.v !== 1 || !type) throw new Error('Unsupported pass version');
	return {
		id: w.i,
		estateId: w.e,
		unitId: w.u,
		type,
		name: w.n ?? '',
		validFrom: w.f,
		validTo: w.x,
		maxEntries: w.m,
		schedule: w.s ? { days: w.s[0], start: w.s[1], end: w.s[2] } : null,
		iat: w.a
	};
};

export function generateSigningKey(): { secretKey: string; publicKey: string } {
	const sk = ed25519.utils.randomSecretKey();
	return { secretKey: bytesToB64url(sk), publicKey: bytesToB64url(ed25519.getPublicKey(sk)) };
}

export function signPass(claims: PassClaims, secretKeyB64: string): string {
	const payload = bytesToB64url(utf8.encode(JSON.stringify(toWire(claims))));
	const sig = ed25519.sign(utf8.encode(payload), b64urlToBytes(secretKeyB64));
	return `${payload}.${bytesToB64url(sig)}`;
}

export type VerifyResult = { ok: true; claims: PassClaims } | { ok: false; reason: 'bad_signature' };

export function verifyPass(token: string, publicKeyB64: string): VerifyResult {
	try {
		const [payload, sig, extra] = token.trim().split('.');
		if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'bad_signature' };
		const valid = ed25519.verify(b64urlToBytes(sig), utf8.encode(payload), b64urlToBytes(publicKeyB64));
		if (!valid) return { ok: false, reason: 'bad_signature' };
		return { ok: true, claims: fromWire(JSON.parse(utf8.decode(b64urlToBytes(payload)))) };
	} catch {
		return { ok: false, reason: 'bad_signature' };
	}
}

/** Read claims WITHOUT verifying (for display on the visitor share page only). */
export function peekPass(token: string): PassClaims | null {
	try {
		return fromWire(JSON.parse(utf8.decode(b64urlToBytes(token.split('.')[0]))));
	} catch {
		return null;
	}
}

/**
 * Pull a token out of whatever the scanner read: a share URL (`…/p/<token>`)
 * or the bare token. Returns null if it isn't one of ours.
 */
export function extractToken(scanned: string): string | null {
	const s = scanned.trim();
	const m = s.match(/\/p\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?:[?#].*)?$/);
	if (m) return m[1];
	if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) return s;
	return null;
}
