import { requireResident } from '$lib/server/guards';
import { listUnitPasses } from '$lib/server/passes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const r = requireResident(event);
	const passes = await listUnitPasses(r.estate.id, r.unit.id);
	return {
		passes: passes.map((p) => ({
			id: p.id,
			type: p.type,
			name: p.visitorName,
			purpose: p.purpose,
			code: p.code,
			validFrom: p.validFrom.getTime(),
			validTo: p.validTo?.getTime() ?? null,
			schedule: p.schedule,
			maxEntries: p.maxEntries,
			entriesUsed: p.entriesUsed,
			mine: p.createdBy === r.user.id
		}))
	};
};
