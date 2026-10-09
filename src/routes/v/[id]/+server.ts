import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Short pass link for messages (`/v/<pass id>`, ~40 characters instead of
 * ~280), so a pass fits in a single text message. It redirects to the full
 * signed link, whose page shows the code and the QR the gate scans offline.
 * Pass ids are 10 random characters (31^10 ≈ 8×10^14), far harder to guess
 * than the gate code the same message already contains.
 */
export const GET: RequestHandler = async ({ params, setHeaders }) => {
	if (!/^[a-z0-9]{6,32}$/.test(params.id)) error(404, 'This pass link is not valid');
	const db = await getDb();
	const [pass] = await db.select({ token: schema.passes.token }).from(schema.passes).where(eq(schema.passes.id, params.id));
	if (!pass) error(404, 'This pass link is not valid');
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
	redirect(302, `/p/${pass.token}`);
};
