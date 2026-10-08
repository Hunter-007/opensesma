import { redirect } from '@sveltejs/kit';
import { attempt, requireResident } from '$lib/server/guards';
import { getPassForUnit, revokePass, shareMessage, shareUrl } from '$lib/server/passes';
import { qrSvg } from '$lib/server/qr';
import { unitLabel } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const r = requireResident(event);
	const { pass, events, live } = await getPassForUnit(r.estate.id, r.unit.id, event.params.id);
	const url = shareUrl(pass.token);
	return {
		isNew: event.url.searchParams.has('new'),
		pass: {
			id: pass.id,
			type: pass.type,
			name: pass.visitorName,
			phone: pass.visitorPhone,
			purpose: pass.purpose,
			code: pass.code,
			validFrom: pass.validFrom.getTime(),
			validTo: pass.validTo?.getTime() ?? null,
			schedule: pass.schedule,
			maxEntries: pass.maxEntries,
			entriesUsed: pass.entriesUsed,
			status: pass.status,
			live
		},
		shareUrl: url,
		message: shareMessage(pass, r.estate, unitLabel(r.unit), { hostName: r.user.name || undefined }),
		qr: await qrSvg(url),
		events: events.map((e) => ({ id: e.id, kind: e.kind, at: e.deviceTs.getTime(), guard: e.guardName, offline: e.offline }))
	};
};

export const actions: Actions = {
	revoke: async (event) => {
		const r = requireResident(event);
		const result = await attempt(() => revokePass(r.estate.id, r.user.id, event.params.id, { unitId: r.unit.id }));
		if ('id' in result) redirect(303, '/app');
		return result;
	}
};
