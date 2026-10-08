import { requireResident } from '$lib/server/guards';
import { listEvents } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const r = requireResident(event);
	const events = await listEvents(r.estate.id, { unitId: r.unit.id, from: new Date(Date.now() - 30 * 86_400_000), limit: 200 });
	return {
		events: events
			.filter((e) => e.kind !== 'deny')
			.map((e) => ({ id: e.id, kind: e.kind, name: e.visitorName, type: e.passType, gate: e.gateName, guard: e.guardName, at: e.deviceTs.getTime(), reason: e.reason, passId: e.passId }))
	};
};
