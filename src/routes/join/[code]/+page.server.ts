import { redirect } from '@sveltejs/kit';
import { acceptInvite, findInvite } from '$lib/server/estates';
import { setActiveEstate } from '$lib/server/auth';
import { attempt, requireUser, str } from '$lib/server/guards';
import { unitLabel } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const found = await findInvite(params.code);
	if (!found) return { invite: null };
	const { invite, estate, unit } = found;
	const masked = invite.phone ? `${invite.phone.slice(0, 7)}•••${invite.phone.slice(-2)}` : null;
	return {
		invite: {
			name: invite.name,
			role: invite.role,
			estateName: estate.name,
			unitLabel: unit ? unitLabel(unit) : null,
			maskedPhone: masked
		},
		signedIn: !!locals.auth,
		userName: locals.auth?.user.name ?? ''
	};
};

export const actions: Actions = {
	default: async (event) => {
		const auth = requireUser(event);
		const fd = await event.request.formData();
		const result = await attempt(() => acceptInvite(event.params.code, auth.user, str(fd, 'name')));
		if (result && 'id' in result) {
			if (event.locals.sessionToken) await setActiveEstate(event.locals.sessionToken, result.id);
			redirect(303, '/');
		}
		return result;
	}
};
