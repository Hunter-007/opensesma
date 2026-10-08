import { attempt, requireResident, str } from '$lib/server/guards';
import { decideWalkin, getWalkinForUser } from '$lib/server/gate';
import { unitLabel } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const r = requireResident(event);
	const { w, unit, gate } = await getWalkinForUser(event.params.id, r.user.id);
	return {
		walkin: {
			id: w.id,
			name: w.visitorName,
			phone: w.visitorPhone,
			purpose: w.purpose,
			status: w.status,
			gate: gate.name,
			guard: w.guardName,
			unit: unitLabel(unit),
			createdAt: w.createdAt.getTime(),
			decidedByName: w.decidedByName
		},
		action: event.url.searchParams.get('action')
	};
};

export const actions: Actions = {
	default: async (event) => {
		const r = requireResident(event);
		await getWalkinForUser(event.params.id, r.user.id); // authorisation
		const fd = await event.request.formData();
		return attempt(async () => {
			const res = await decideWalkin(event.params.id, str(fd, 'decision') === 'approve', { userId: r.user.id, name: r.user.name || 'Resident' }, str(fd, 'note'));
			return { decided: true, already: res.alreadyDecided, status: res.walkin.status, by: res.walkin.decidedByName };
		});
	}
};
