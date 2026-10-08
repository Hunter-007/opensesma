import { api } from '$lib/server/guards';
import { saveSubscription } from '$lib/server/push';
import { AppError } from '$lib/server/util';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, locals }) =>
	api(async () => {
		if (!locals.auth) throw new AppError('Sign in first', 401);
		const sub = await request.json();
		if (typeof sub?.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth)
			throw new AppError('Invalid subscription');
		await saveSubscription(locals.auth.user.id, sub);
		return { ok: true };
	});
