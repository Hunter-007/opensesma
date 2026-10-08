/**
 * Apply SQL migrations in ./drizzle to a self-managed Postgres at DATABASE_URL.
 * NOT used on Netlify: Netlify Database applies netlify/database/migrations/
 * during each deploy. PGlite (dev) migrates itself on start.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL || '';
if (!/^postgres(ql)?:\/\//.test(url)) {
	console.log('No Postgres DATABASE_URL set; skipping migrations (embedded dev database migrates itself).');
	process.exit(0);
}
const client = postgres(url, { max: 1, prepare: false });
await migrate(drizzle(client), { migrationsFolder: './drizzle' });
await client.end();
console.log('Migrations applied.');
