/**
 * Drizzle Kit writes migrations to ./drizzle (with its journal, used by the
 * embedded dev database). Netlify Database applies plain SQL files from
 * netlify/database/migrations/ on every deploy. This copies new ones across.
 * Runs automatically after `npm run db:generate`.
 *
 * Never edit or delete a migration that has been deployed: Netlify rejects
 * modified or removed migrations. Write a new one instead.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';

const from = 'drizzle';
const to = 'netlify/database/migrations';
let copied = 0;
for (const f of readdirSync(from).filter((f) => /^\d+_[a-z0-9_-]+\.sql$/.test(f)).sort()) {
	const dest = `${to}/${f}`;
	if (existsSync(dest)) {
		if (readFileSync(dest, 'utf8') !== readFileSync(`${from}/${f}`, 'utf8'))
			throw new Error(`${dest} differs from ${from}/${f}. Deployed migrations must never change — generate a new one.`);
		continue;
	}
	copyFileSync(`${from}/${f}`, dest);
	copied++;
}
console.log(copied ? `Copied ${copied} migration(s) to ${to}` : 'Netlify migrations already up to date');
