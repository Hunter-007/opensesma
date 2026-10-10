import { api } from '$lib/server/guards';
import { authDevice, buildSync } from '$lib/server/gate';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, url }) =>
	api(async () => {
		const device = await authDevice(request.headers.get('authorization'));
		const p = url.searchParams;
		return buildSync(device, {
			since: p.get('since'),
			unitsHash: p.get('u') ?? undefined,
			guardsHash: p.get('g') ?? undefined,
			bansHash: p.get('b') ?? undefined,
			// The shift this phone thinks is running, so the server can keep it alive or end it.
			shift: p.get('shift') ? { id: p.get('shift'), guardId: p.get('guard'), startedAt: Number(p.get('shiftStart')) || undefined } : undefined
		});
	});
