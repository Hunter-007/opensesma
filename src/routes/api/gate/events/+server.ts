import { api } from '$lib/server/guards';
import { authDevice, ingestEvents } from '$lib/server/gate';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
	api(async () => {
		const device = await authDevice(request.headers.get('authorization'));
		const body = await request.json();
		return ingestEvents(device, body.events ?? [], { sentAt: Number(body.sentAt) });
	});
