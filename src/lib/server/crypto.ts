import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config';

// Separate keys derived from APP_SECRET for each purpose (key encryption vs OTP hashing).
const deriveKey = (secret: string) => createHash('sha256').update('opensesma:key-encryption:' + secret).digest();
const key = () => deriveKey(config.appSecret);

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

function decryptWith(k: Buffer, enc: string): string {
	const [iv, tag, ct] = enc.split('.').map((s) => Buffer.from(s, 'base64url'));
	const decipher = createDecipheriv('aes-256-gcm', k, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Decrypt with APP_SECRET, falling back to APP_SECRET_PREVIOUS so the secret can
 * be rotated: set the old value as APP_SECRET_PREVIOUS, the new one as
 * APP_SECRET, run `npm run secrets:rotate` to re-encrypt, then remove the old.
 */
export function decryptSecret(enc: string): string {
	try {
		return decryptWith(key(), enc);
	} catch (err) {
		const previous = process.env.APP_SECRET_PREVIOUS;
		if (!previous) throw err;
		return decryptWith(deriveKey(previous), enc);
	}
}

/** Keyed hash for OTPs and other short secrets we must compare but never store. */
export function hmac(value: string): string {
	return createHmac('sha256', 'opensesma:hmac:' + config.appSecret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
