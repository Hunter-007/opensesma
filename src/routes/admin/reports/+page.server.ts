import { requireAdmin } from '$lib/server/guards';
import { report } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const days = event.url.searchParams.get('days') === '30' ? 30 : 7;
	return { days, report: await report(a.estateId, a.estate.timeZone, days) };
};
