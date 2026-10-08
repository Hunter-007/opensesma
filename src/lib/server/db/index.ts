import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: DB | null = null;
let pending: Promise<DB> | null = null;

/**
 * Production: DATABASE_URL points at Postgres (Netlify DB/Neon, Supabase…).
 * Development/tests: no DATABASE_URL → embedded PGlite (real Postgres in WASM),
 * persisted to ./.data/pglite, or in-memory when DATABASE_URL=memory://.
 */
export async function getDb(): Promise<DB> {
	if (instance) return instance;
	if (!pending) pending = connect();
	instance = await pending;
	return instance;
}

async function connect(): Promise<DB> {
	// Netlify DB (Neon) exposes NETLIFY_DATABASE_URL; any other Postgres uses DATABASE_URL.
	const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || '';
	if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
		const postgres = (await import('postgres')).default;
		const client = postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
		return drizzlePostgres(client, { schema }) as unknown as DB;
	}
	if (!url && process.env.NODE_ENV === 'production')
		throw new Error('DATABASE_URL is not set. Point it at Postgres (e.g. Netlify DB / Neon), or set DATABASE_URL=pglite://./.data/pglite for a single-server install.');
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
