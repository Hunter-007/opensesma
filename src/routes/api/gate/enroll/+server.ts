import { api } from '$lib/server/guards';
import { enrollDevice } from '$lib/server/gate';
import { AppError, rateLimit } from '$lib/server/util';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, getClientAddress }) =>
	api(async () => {
		if (!(await rateLimit(`enroll:${getClientAddress()}`, 10, 600))) throw new AppError('Too many attempts. Wait 10 minutes.', 429);
		const body = await request.json().catch(() => ({}));
		return enrollDevice(String(body.code ?? ''));
	});
