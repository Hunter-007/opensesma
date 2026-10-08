import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { databaseKind, getDb, schema } from '$lib/server/db';
import { config } from '$lib/server/config';
import { pushEnabled } from '$lib/server/push';
import { safeEqual } from '$lib/server/crypto';
import type { RequestHandler } from './$types';

/**
 * Deployment check. Public callers only learn up/down; the details (database
 * kind, error text, settings) need `Authorization: Bearer <CRON_SECRET>`.
 */
export const GET: RequestHandler = async ({ request }) => {
	const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	const detailed = !!config.cronSecret && safeEqual(given, config.cronSecret);
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
	const ok = checks.db === 'ok' && checks.appSecret === 'set';
	return json(detailed ? { ok, ...checks } : { ok }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
};
