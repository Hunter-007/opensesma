import { api } from '$lib/server/guards';
import { decideWalkin, getWalkinForUser } from '$lib/server/gate';
import { AppError } from '$lib/server/util';
import type { RequestHandler } from './$types';

/** Used by the service worker when a resident taps "Let in" / "Decline" on the notification itself. */
export const POST: RequestHandler = ({ request, params, locals }) =>
	api(async () => {
		if (!locals.auth) throw new AppError('Sign in first', 401);
		await getWalkinForUser(params.id, locals.auth.user.id);
		const b = await request.json().catch(() => ({}));
		const res = await decideWalkin(params.id, b.decision === 'approve', { userId: locals.auth.user.id, name: locals.auth.user.name || 'Resident' });
		return { status: res.walkin.status, already: res.alreadyDecided, by: res.walkin.decidedByName };
	});
