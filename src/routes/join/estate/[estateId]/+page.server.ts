import { error } from '@sveltejs/kit';
import { getEstate, listUnits, requestToJoin } from '$lib/server/estates';
import { attempt, requireUser, str } from '$lib/server/guards';
import { AppError, rateLimit } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

// Only street names are shown, never the full list of house numbers: the join
// link is shared in WhatsApp groups and shouldn't double as an address book.
export const load: PageServerLoad = async (event) => {
	const auth = requireUser(event);
	const estate = await getEstate(event.params.estateId).catch(() => null);
	if (!estate) error(404, 'Estate not found');
	const existing = auth.memberships.find((m) => m.estate.id === estate.id);
	const streets = [...new Set((await listUnits(estate.id)).filter((u) => u.active).map((u) => u.street))].sort();
	return { estateName: estate.name, streets, status: existing?.membership.status ?? null, name: auth.user.name };
};

export const actions: Actions = {
	default: async (event) => {
		const auth = requireUser(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			if (!(await rateLimit(`join:${auth.user.id}`, 5, 3600))) throw new AppError('Too many attempts. Try again in an hour.', 429);
			const proof = str(fd, 'proof');
			if (!proof) throw new AppError('Tell the estate manager how they can confirm you live there');
			const street = str(fd, 'street');
			const number = str(fd, 'number').replace(/^no\.?\s*/i, '');
			const unit = (await listUnits(event.params.estateId)).find(
				(u) => u.active && u.street === street && u.number.toLowerCase() === number.toLowerCase()
			);
			if (!unit) throw new AppError("We couldn't find that house. Check the street and number, or ask the estate manager.");
			await requestToJoin(event.params.estateId, unit.id, auth.user.id, str(fd, 'name'), proof);
			return { sent: true };
		}, Object.fromEntries(fd));
	}
};
