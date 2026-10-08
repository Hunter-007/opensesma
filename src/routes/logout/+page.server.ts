import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, destroySession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: async ({ locals, cookies }) => {
		if (locals.sessionToken) await destroySession(locals.sessionToken);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
