import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: DB | null = null;
let pending: Promise<DB> | null = null;

/**
 * Where the data lives:
 * - Netlify: Netlify Database. Netlify provisions it because `@netlify/database`
 *   is installed, applies `netlify/database/migrations/` on each deploy, and
 *   exposes the connection string as NETLIFY_DB_URL.
 * - Any other Postgres: DATABASE_URL (run `npm run db:migrate` yourself).
 * - Development/tests: nothing set → embedded PGlite (real Postgres in WASM),
 *   persisted to ./.data/pglite, or in-memory when DATABASE_URL=memory://.
 */
export async function getDb(): Promise<DB> {
	if (instance) return instance;
	if (!pending) pending = connect().catch((e) => {
		pending = null; // let the next request retry (e.g. database waking from scale-to-zero)
		throw e;
	});
	instance = await pending;
	return instance;
}

/** Which kind of database is configured, without revealing the connection string. */
export function databaseKind(): 'postgres' | 'netlify' | 'pglite' | 'none' {
	if (/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) return 'postgres';
	if (process.env.NETLIFY_DB_URL || process.env.NETLIFY_DATABASE_URL) return 'netlify';
	if (process.env.DATABASE_URL || process.env.NODE_ENV !== 'production') return 'pglite';
	return 'none';
}

async function resolveUrl(): Promise<string> {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	if (process.env.NETLIFY_DB_URL) return process.env.NETLIFY_DB_URL;
	// Netlify's helper also reads the runtime context, not just process.env.
	try {
		const { getConnectionString } = await import('@netlify/database');
		return getConnectionString();
	} catch {
		/* not on Netlify */
	}
	return process.env.NETLIFY_DATABASE_URL ?? ''; // legacy Netlify DB (Neon extension)
}

async function connect(): Promise<DB> {
	const url = await resolveUrl();
	if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
		const postgres = (await import('postgres')).default;
		const client = postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
		return drizzlePostgres(client, { schema }) as unknown as DB;
	}
	if (!url && process.env.NODE_ENV === 'production')
		throw new Error('No database configured. On Netlify, Netlify Database provides NETLIFY_DB_URL; elsewhere set DATABASE_URL to Postgres, or DATABASE_URL=pglite://./.data/pglite for a single-server install.');
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle } = await import('drizzle-orm/pglite');
	const dataDir = url.startsWith('memory://') ? undefined : url.replace(/^pglite:\/\//, '') || './.data/pglite';
	if (dataDir) (await import('node:fs')).mkdirSync(dataDir, { recursive: true });
	const client = new PGlite(dataDir);
	const db = drizzle(client, { schema }) as unknown as DB;
	// Embedded databases migrate themselves so `npm run dev` just works.
	const { migrate } = await import('drizzle-orm/pglite/migrator');
	await migrate(db as never, { migrationsFolder: './drizzle' });
	return db;
}

/** Tests only: swap in a fresh database. */
export function setDb(db: DB | null) {
	instance = db;
	pending = db ? Promise.resolve(db) : null;
}

export { schema };
