import { api } from '$lib/server/guards';
import { authDevice } from '$lib/server/gate';
import { endShift, startShift } from '$lib/server/shifts';
import type { RequestHandler } from './$types';

/** Start or end a guard's shift on this gate phone. */
export const POST: RequestHandler = ({ request }) =>
	api(async () => {
		const device = await authDevice(request.headers.get('authorization'));
		const b = (await request.json().catch(() => ({}))) as { action?: string; shiftId?: string; guardId?: string; startedAt?: number };
		if (b.action === 'end') {
			await endShift(device, String(b.shiftId ?? ''));
			return { ok: true };
		}
		const shift = await startShift(device, { shiftId: String(b.shiftId ?? ''), guardUserId: String(b.guardId ?? ''), startedAt: Number(b.startedAt) || undefined });
		return { ok: true, shiftId: shift.id };
	});
