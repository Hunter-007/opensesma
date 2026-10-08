import { sql } from 'drizzle-orm';
import { getDb, schema, type DB } from './db';

/** Thrown for expected, user-facing failures. Routes turn these into 4xx responses. */
export class AppError extends Error {
	constructor(
		message: string,
		public status = 400,
		public code = 'bad_request'
	) {
		super(message);
	}
}

export async function audit(
	db: DB,
	entry: { estateId?: string | null; actorUserId?: string | null; action: string; entity: string; entityId?: string | null; data?: Record<string, unknown> }
) {
	await db.insert(schema.auditLogs).values({
		estateId: entry.estateId ?? null,
		actorUserId: entry.actorUserId ?? null,
		action: entry.action,
		entity: entry.entity,
		entityId: entry.entityId ?? null,
		data: entry.data ?? null
	});
}

/**
 * Fixed-window rate limiter stored in Postgres (works across serverless
 * instances). Returns true when the call is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
	const db = await getDb();
	const rows = await db.execute<{ count: number }>(sql`
		insert into rate_limits (key, count, window_start) values (${key}, 1, now())
		on conflict (key) do update set
			count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
			window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
		returning count`);
	const list = Array.isArray(rows) ? rows : (rows as unknown as { rows: { count: number }[] }).rows;
	return Number(list[0]?.count ?? 0) <= limit;
}

export const unitLabel = (u: { street: string; number: string }) => `${u.number} ${u.street}`;
