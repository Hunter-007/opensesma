/**
 * Runs against Netlify's local Postgres engine with the migrations exactly as
 * Netlify applies them on deploy, through the production driver (postgres.js).
 * Skipped automatically if the engine can't start in this environment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let NetlifyDB: typeof import('@netlify/database-dev').NetlifyDB | null = null;
try {
	({ NetlifyDB } = await import('@netlify/database-dev'));
} catch {
	NetlifyDB = null;
}

describe.skipIf(!NetlifyDB)('Netlify Database (production path)', () => {
	let db: InstanceType<NonNullable<typeof NetlifyDB>>;

	beforeAll(async () => {
		db = new NetlifyDB!();
		process.env.DATABASE_URL = await db.start();
		await db.applyMigrations('./netlify/database/migrations');
	}, 120_000);
	afterAll(async () => {
		await db?.stop();
	});

	it('migrations apply and the app works through postgres.js', async () => {
		const { getDb, databaseKind } = await import('../src/lib/server/db');
		expect(databaseKind()).toBe('postgres');
		await getDb();
		const estates = await import('../src/lib/server/estates');
		const passes = await import('../src/lib/server/passes');
		const { rateLimit } = await import('../src/lib/server/util');
		const c = await estates.createEstate({ name: 'Prod Path', gateNames: ['Main'], admin: { phone: '08010000001', name: 'A' } });
		const unit = await estates.addUnit(c.estate.id, 'Main Road', '1');
		const p = await passes.createPass({ userId: c.admin.id, estateId: c.estate.id, unitId: unit.id }, { type: 'delivery' });
		expect(p.code).toMatch(/^\d{6}$/);
		expect(await rateLimit('t:1', 1, 60)).toBe(true);
		expect(await rateLimit('t:1', 1, 60)).toBe(false);
	});
});
