import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, destroySession } from '$lib/server/auth';
import { safeNext } from '$lib/shared/redirect';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: async ({ locals, cookies, url }) => {
		if (locals.sessionToken) await destroySession(locals.sessionToken);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		const next = safeNext(url.searchParams.get('next'));
		redirect(303, next === '/' ? '/login' : next);
	}
};
