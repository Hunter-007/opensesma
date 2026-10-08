import { redirect } from '@sveltejs/kit';
import { requestOtp, verifyOtp } from '$lib/server/auth';
import { attempt, setSessionCookie, str } from '$lib/server/guards';
import { safeNext } from '$lib/shared/redirect';
import type { Actions, PageServerLoad } from './$types';


export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.auth) redirect(303, safeNext(url.searchParams.get('next')));
	return { next: safeNext(url.searchParams.get('next')) };
};

export const actions: Actions = {
	send: async ({ request, getClientAddress }) => {
		const fd = await request.formData();
		const phone = str(fd, 'phone');
		return attempt(async () => {
			const r = await requestOtp(phone, { ip: getClientAddress() });
			return { step: 'code' as const, phone: r.phone, devCode: r.devCode };
		}, { phone });
	},
	verify: async ({ request, cookies, url, getClientAddress }) => {
		const fd = await request.formData();
		const phone = str(fd, 'phone');
		const result = await attempt(async () => verifyOtp(phone, str(fd, 'code'), { ip: getClientAddress() }), { phone, step: 'code' });
		if ('token' in result) {
			setSessionCookie(cookies, result.token);
			redirect(303, safeNext(url.searchParams.get('next')));
		}
		return result;
	}
};
