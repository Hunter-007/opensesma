import { error } from '@sveltejs/kit';
import { getEstate, listUnits, requestToJoin } from '$lib/server/estates';
import { attempt, requireUser, str } from '$lib/server/guards';
import { AppError } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const auth = requireUser(event);
	const estate = await getEstate(event.params.estateId).catch(() => null);
	if (!estate) error(404, 'Estate not found');
	const existing = auth.memberships.find((m) => m.estate.id === estate.id);
	const units = (await listUnits(estate.id)).filter((u) => u.active).map((u) => ({ id: u.id, label: u.label }));
	return { estateName: estate.name, units, status: existing?.membership.status ?? null, name: auth.user.name };
};

export const actions: Actions = {
	default: async (event) => {
		const auth = requireUser(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const proof = str(fd, 'proof');
			if (!proof) throw new AppError('Tell the estate manager how they can confirm you live there');
			await requestToJoin(event.params.estateId, str(fd, 'unitId'), auth.user.id, str(fd, 'name'), proof);
			return { sent: true };
		});
	}
};
