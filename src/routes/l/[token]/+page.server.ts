import { redirect } from '@sveltejs/kit';
import { findSignInLink, useSignInLink } from '$lib/server/links';
import { attempt, setSessionCookie } from '$lib/server/guards';
import type { Actions, PageServerLoad } from './$types';

// Opening the link only shows who it's for. Signing in needs the button (POST),
// so WhatsApp's link preview fetching the page can't use up the link.
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
	const link = await findSignInLink(params.token);
	return { link: link ? { firstName: link.name.split(' ')[0], estateName: link.estateName } : null };
};

export const actions: Actions = {
	default: async ({ params, cookies, getClientAddress }) => {
		const result = await attempt(() => useSignInLink(params.token, { ip: getClientAddress() }));
		if (typeof result === 'string') {
			setSessionCookie(cookies, result);
			redirect(303, '/');
		}
		return result;
	}
};
