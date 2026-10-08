import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { databaseKind, getDb, schema } from '$lib/server/db';
import { config } from '$lib/server/config';
import { pushEnabled } from '$lib/server/push';
import type { RequestHandler } from './$types';

/** Deployment check: is the database reachable and migrated? No secrets are returned. */
export const GET: RequestHandler = async () => {
	const checks: Record<string, unknown> = { database: databaseKind(), sms: config.smsDriver, push: pushEnabled() };
	try {
		const db = await getDb();
		const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.estates);
		checks.db = 'ok';
		checks.estates = n;
	} catch (e) {
		checks.db = 'error';
		checks.error = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
	}
	try {
		void config.appSecret;
		checks.appSecret = 'set';
	} catch {
		checks.appSecret = 'missing';
	}
	return json({ ok: checks.db === 'ok' && checks.appSecret === 'set', ...checks }, { status: checks.db === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
};
