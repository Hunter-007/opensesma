import { requireResident } from '$lib/server/guards';
import { pendingWalkinsForUser } from '$lib/server/gate';
import { config } from '$lib/server/config';
import { unitLabel } from '$lib/server/util';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const r = requireResident(event);
	const walkins = await pendingWalkinsForUser(r.user.id);
	return {
		me: { id: r.user.id, name: r.user.name, phone: r.user.phone, role: r.membership.role },
		estate: { id: r.estate.id, name: r.estate.name, timeZone: r.estate.timeZone, levyRule: r.estate.settings.levyRule, disabledPassTypes: r.estate.settings.disabledPassTypes },
		unit: { id: r.unit.id, label: unitLabel(r.unit), duesStatus: r.unit.duesStatus },
		pendingWalkins: walkins.map((w) => ({ id: w.w.id, name: w.w.visitorName, purpose: w.w.purpose, gateName: w.gateName, createdAt: w.w.createdAt.getTime() })),
		vapidKey: config.vapid.publicKey || null
	};
};
