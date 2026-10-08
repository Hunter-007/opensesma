/**
 * Re-encrypt every estate's signing key with the current APP_SECRET.
 * 1. Set APP_SECRET_PREVIOUS = old secret, APP_SECRET = new secret.
 * 2. Run: DATABASE_URL=… npm run secrets:rotate
 * 3. Remove APP_SECRET_PREVIOUS.
 * Passes keep working throughout: only the encryption at rest changes.
 * (Login codes in flight when the secret changes will need to be re-sent.)
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../src/lib/server/db';
import { decryptSecret, encryptSecret } from '../src/lib/server/crypto';

const db = await getDb();
const estates = await db.select().from(schema.estates);
for (const e of estates) {
	const plain = decryptSecret(e.signingSecretKeyEnc);
	await db.update(schema.estates).set({ signingSecretKeyEnc: encryptSecret(plain) }).where(eq(schema.estates.id, e.id));
}
console.log(`Re-encrypted signing keys for ${estates.length} estate(s).`);
process.exit(0);
