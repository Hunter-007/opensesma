import { error } from '@sveltejs/kit';
import { attempt, str } from '$lib/server/guards';
import { decideWalkin, getWalkinByReplyToken } from '$lib/server/gate';
import { unitLabel } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

/**
 * The SMS fallback link. The unguessable token in the URL (sent only to the
 * household's phones) authorises one decision on one request, so a resident
 * can answer from a basic browser without signing in.
 */
export const load: PageServerLoad = async ({ params }) => {
	const row = await getWalkinByReplyToken(params.token);
	if (!row) error(404, 'This link is not valid');
	const { w, unit, gate } = row;
	return {
		walkin: {
			name: w.visitorName,
			phone: w.visitorPhone,
			purpose: w.purpose,
			status: Date.now() - w.createdAt.getTime() > 15 * 60_000 && w.status === 'pending' ? 'expired' : w.status,
			gate: gate.name,
			guard: w.guardName,
			unit: unitLabel(unit),
			createdAt: w.createdAt.getTime(),
			decidedByName: w.decidedByName
		}
	};
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const row = await getWalkinByReplyToken(params.token);
		if (!row) error(404, 'This link is not valid');
		const fd = await request.formData();
		return attempt(async () => {
			const res = await decideWalkin(row.w.id, str(fd, 'decision') === 'approve', { userId: null, name: 'Resident (SMS)' }, str(fd, 'note'));
			return { decided: true, already: res.alreadyDecided, status: res.walkin.status, by: res.walkin.decidedByName };
		});
	}
};
