import { api } from '$lib/server/guards';
import { authDevice, buildSync } from '$lib/server/gate';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, url }) =>
	api(async () => {
		const device = await authDevice(request.headers.get('authorization'));
		return buildSync(device, {
			since: url.searchParams.get('since'),
			unitsHash: url.searchParams.get('u') ?? undefined,
			guardsHash: url.searchParams.get('g') ?? undefined,
			bansHash: url.searchParams.get('b') ?? undefined
		});
	});
