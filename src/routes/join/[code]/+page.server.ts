import { redirect } from '@sveltejs/kit';
import { acceptInvite, findInvite } from '$lib/server/estates';
import { setActiveEstate } from '$lib/server/auth';
import { acceptInviteAndSignIn } from '$lib/server/links';
import { attempt, setSessionCookie, str } from '$lib/server/guards';
import { unitLabel } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
	const found = await findInvite(params.code);
	if (!found) return { invite: null };
	const { invite, estate, unit } = found;
	return {
		invite: {
			name: invite.name,
			role: invite.role,
			estateName: estate.name,
			unitLabel: unit ? unitLabel(unit) : null,
			// Invites made out to a phone number sign the person straight in.
			linkSignIn: !!invite.phone
		},
		signedIn: !!locals.auth,
		// Someone already signed in on this phone with a different number.
		otherAccount: !!locals.auth && !!invite.phone && locals.auth.user.phone !== invite.phone,
		userName: locals.auth?.user.name ?? ''
	};
};

export const actions: Actions = {
	default: async (event) => {
		const fd = await event.request.formData();
		const name = str(fd, 'name');
		const auth = event.locals.auth;
		if (!auth) {
			const result = await attempt(() => acceptInviteAndSignIn(event.params.code, name, { ip: event.getClientAddress() }), { name });
			if ('session' in result) {
				setSessionCookie(event.cookies, result.session);
				redirect(303, '/');
			}
			return result;
		}
		const result = await attempt(() => acceptInvite(event.params.code, auth.user, name), { name });
		if (result && 'id' in result) {
			if (event.locals.sessionToken) await setActiveEstate(event.locals.sessionToken, result.id);
			redirect(303, '/');
		}
		return result;
	}
};
