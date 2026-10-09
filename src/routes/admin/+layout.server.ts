import { requireAdmin } from '$lib/server/guards';
import { config } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const a = requireAdmin(event);
	return {
		me: { id: a.user.id, name: a.user.name, role: a.membership.role },
		estate: { id: a.estate.id, name: a.estate.name, timeZone: a.estate.timeZone, settings: a.estate.settings, address: a.estate.address },
		joinUrl: `${config.publicUrl}/join/estate/${a.estate.id}`,
		// Without SMS codes, people can only sign in through invites and sign-in links.
		smsLogin: config.smsLoginEnabled,
		vapidKey: config.vapid.publicKey || null
	};
};
