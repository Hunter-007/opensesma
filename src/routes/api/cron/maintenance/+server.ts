import { api } from '$lib/server/guards';
import { config } from '$lib/server/config';
import { runRetention } from '$lib/server/gate';
import { AppError } from '$lib/server/util';
import { safeEqual } from '$lib/server/crypto';
import type { RequestHandler } from './$types';

/** Daily job (Netlify scheduled function calls this): NDPA retention + housekeeping. */
export const POST: RequestHandler = ({ request }) =>
	api(async () => {
		const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
		if (!config.cronSecret || !safeEqual(given, config.cronSecret)) throw new AppError('Forbidden', 403);
		return runRetention();
	});
