import { redirect } from '@sveltejs/kit';
import { isAdminRole, isResidentRole } from '$lib/shared/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const active = locals.auth?.active;
	if (active) {
		if (isAdminRole(active.membership.role)) redirect(303, '/admin');
		if (isResidentRole(active.membership.role)) redirect(303, '/app');
		if (active.membership.role === 'guard') redirect(303, '/gate');
	}
	if (locals.auth) redirect(303, '/welcome');
	return {};
};
