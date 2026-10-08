import { api } from '$lib/server/guards';
import { saveSubscription } from '$lib/server/push';
import { AppError } from '$lib/server/util';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, locals }) =>
	api(async () => {
		if (!locals.auth) throw new AppError('Sign in first', 401);
		const sub = await request.json();
		if (typeof sub?.endpoint !== 'string' || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || sub.endpoint.length > 1000)
			throw new AppError('Invalid subscription');
		await saveSubscription(locals.auth.user.id, sub);
		return { ok: true };
	});
