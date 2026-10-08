import { redirect } from '@sveltejs/kit';
import { setActiveEstate } from '$lib/server/auth';
import { requireUser, str } from '$lib/server/guards';
import { isAdminRole, isResidentRole } from '$lib/shared/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const auth = requireUser(event);
	const active = auth.active;
	if (active && isAdminRole(active.membership.role)) redirect(303, '/admin');
	if (active && isResidentRole(active.membership.role) && active.unit) redirect(303, '/app');
	return {
		name: auth.user.name,
		phone: auth.user.phone,
		memberships: auth.memberships.map((m) => ({
			estateId: m.estate.id,
			estateName: m.estate.name,
			role: m.membership.role,
			status: m.membership.status
		}))
	};
};

export const actions: Actions = {
	switch: async (event) => {
		requireUser(event);
		const fd = await event.request.formData();
		if (event.locals.sessionToken) await setActiveEstate(event.locals.sessionToken, str(fd, 'estateId'));
		redirect(303, '/');
	}
};
