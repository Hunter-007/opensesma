import { api } from '$lib/server/guards';
import { authDevice, createWalkin } from '$lib/server/gate';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
	api(async () => {
		const device = await authDevice(request.headers.get('authorization'));
		const b = await request.json();
		const w = await createWalkin(device, {
			unitId: String(b.unitId ?? ''),
			visitorName: String(b.visitorName ?? ''),
			visitorPhone: b.visitorPhone ? String(b.visitorPhone) : undefined,
			purpose: b.purpose ? String(b.purpose) : undefined,
			guardName: b.guardName ? String(b.guardName) : undefined
		});
		return { id: w.id, status: w.status, unitLabel: w.unitLabel };
	});
