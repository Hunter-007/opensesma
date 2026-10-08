import { api } from '$lib/server/guards';
import { authDevice, pollWalkin } from '$lib/server/gate';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, params }) =>
	api(async () => {
		const device = await authDevice(request.headers.get('authorization'));
		return pollWalkin(device, params.id);
	});
