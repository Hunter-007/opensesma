import { error, redirect } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import { createEstate } from '$lib/server/estates';
import { createSession } from '$lib/server/auth';
import { attempt, setSessionCookie, str } from '$lib/server/guards';
import { AppError } from '$lib/server/util';
import { safeEqual } from '$lib/server/crypto';
import type { Actions, PageServerLoad } from './$types';

/**
 * Creating an estate is open only on a brand-new install (no estates yet), or
 * with ?token=SETUP_TOKEN so the operator can onboard further estates.
 */
async function allowed(url: URL) {
	const token = process.env.SETUP_TOKEN;
	const given = url.searchParams.get('token') ?? '';
	if (token && given && safeEqual(token, given)) return true;
	const db = await getDb();
	const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.estates);
	return n === 0;
}

export const load: PageServerLoad = async ({ url }) => {
	if (!(await allowed(url))) error(403, 'Estate setup is closed. Ask the OpenSesma operator for a setup link.');
	return {};
};

export const actions: Actions = {
	default: async ({ request, url, cookies }) => {
		if (!(await allowed(url))) error(403, 'Estate setup is closed');
		const fd = await request.formData();
		const values = Object.fromEntries(fd) as Record<string, string>;
		const result = await attempt(async () => {
			const gateNames = str(fd, 'gates')
				.split(/[\n,]/)
				.map((g) => g.trim())
				.filter(Boolean);
			if (!str(fd, 'name')) throw new AppError('Enter the estate name');
			if (!gateNames.length) throw new AppError('Add at least one gate');
			if (!str(fd, 'adminName')) throw new AppError('Enter the estate manager’s name');
			return createEstate({
				name: str(fd, 'name'),
				address: str(fd, 'address'),
				gateNames,
				admin: { phone: str(fd, 'adminPhone'), name: str(fd, 'adminName') }
			});
		}, values);
		if ('estate' in result) {
			// Sign a brand-new manager straight in on this device. If the phone
			// already belonged to someone, they must prove it with an OTP instead,
			// so a setup link can never be used to take over an existing account.
			const db = await getDb();
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)::int` })
				.from(schema.memberships)
				.where(sql`${schema.memberships.userId} = ${result.admin.id}`);
			if (n > 1) redirect(303, '/login?next=/admin');
			setSessionCookie(cookies, await createSession(result.admin.id, result.estate.id));
			redirect(303, '/admin?welcome=1');
		}
		return result;
	}
};
