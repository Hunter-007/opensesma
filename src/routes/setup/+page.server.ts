import { error, redirect } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import { addDemoData, createEstate } from '$lib/server/estates';
import { createSession } from '$lib/server/auth';
import { attempt, setSessionCookie, str } from '$lib/server/guards';
import { AppError, audit, rateLimit } from '$lib/server/util';
import { safeEqual } from '$lib/server/crypto';
import { config } from '$lib/server/config';
import { normalisePhone } from '$lib/shared/phone';
import { isValidPin } from '$lib/shared/pin';
import type { Actions, PageServerLoad } from './$types';

/**
 * Who may use this page:
 * - in production, only someone holding SETUP_TOKEN (?token=…), so the first
 *   stranger to find a fresh deployment can't claim it;
 * - in development, anyone on an empty install.
 * The token holder (the OpenSesma operator) can also sign back in as an estate
 * manager, since without SMS codes there is no other way for a manager to
 * recover access on a new phone.
 */
async function access(url: URL) {
	const token = process.env.SETUP_TOKEN;
	const given = url.searchParams.get('token') ?? '';
	const db = await getDb();
	const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.estates);
	if (token && given && safeEqual(token, given)) return { ok: true, operator: true, estates: n };
	if (config.isProd) return { ok: false, operator: false, estates: n };
	return { ok: n === 0, operator: false, estates: n };
}

const randomPin = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const a = await access(url);
	if (!a.ok) error(403, 'Estate setup needs a setup link. Ask the OpenSesma operator for one.');
	setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' });
	return { canSignIn: a.operator && a.estates > 0, hasEstates: a.estates > 0, demoPin: randomPin() };
};

export const actions: Actions = {
	create: async ({ request, url, cookies }) => {
		if (!(await access(url)).ok) error(403, 'Estate setup is closed');
		const fd = await request.formData();
		const values = Object.fromEntries(fd) as Record<string, string>;
		const demo = fd.get('demo') === 'on';
		const result = await attempt(async () => {
			const gateNames = str(fd, 'gates')
				.split(/[\n,]/)
				.map((g) => g.trim())
				.filter(Boolean);
			if (!str(fd, 'name')) throw new AppError('Enter the estate name');
			if (!gateNames.length) throw new AppError('Add at least one gate');
			if (!str(fd, 'adminName')) throw new AppError('Enter the estate manager’s name');
			if (demo && !isValidPin(str(fd, 'demoPin'))) throw new AppError('The test guard PIN must be 6 digits');
			const created = await createEstate({
				name: str(fd, 'name'),
				address: str(fd, 'address'),
				gateNames,
				admin: { phone: str(fd, 'adminPhone'), name: str(fd, 'adminName') }
			});
			if (demo) await addDemoData(created.estate.id, created.admin.id, str(fd, 'demoPin'));
			return created;
		}, values);
		if ('estate' in result) {
			// Sign a brand-new manager straight in on this device. If the phone
			// already belonged to someone elsewhere, only the operator (setup token)
			// may sign them in, via "Sign in as estate manager".
			const db = await getDb();
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)::int` })
				.from(schema.memberships)
				.where(sql`${schema.memberships.userId} = ${result.admin.id}`);
			if (n > 1 && !(await access(url)).operator) redirect(303, '/login?next=/admin');
			setSessionCookie(cookies, await createSession(result.admin.id, result.estate.id));
			redirect(303, `/admin?welcome=1${demo ? '&demo=1' : ''}`);
		}
		return result;
	},
	manager: async ({ request, url, cookies, getClientAddress }) => {
		const a = await access(url);
		if (!a.operator) error(403, 'Setup link required');
		const fd = await request.formData();
		const values = { managerPhone: str(fd, 'managerPhone') };
		const result = await attempt(async () => {
			if (!(await rateLimit(`setup-signin:${getClientAddress()}`, 10, 3600))) throw new AppError('Too many attempts. Try again later', 429);
			const phone = normalisePhone(str(fd, 'managerPhone'));
			if (!phone) throw new AppError('Enter a valid phone number');
			const db = await getDb();
			const [row] = await db
				.select({ userId: schema.users.id, estateId: schema.memberships.estateId })
				.from(schema.users)
				.innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
				.where(and(eq(schema.users.phone, phone), eq(schema.memberships.role, 'estate_admin'), eq(schema.memberships.status, 'active')))
				.limit(1);
			if (!row) throw new AppError('No estate manager has that phone number');
			await audit(db, { estateId: row.estateId, actorUserId: row.userId, action: 'manager.setup_signin', entity: 'user', entityId: row.userId });
			return { session: await createSession(row.userId, row.estateId) };
		}, values);
		if ('session' in result) {
			setSessionCookie(cookies, result.session);
			redirect(303, '/admin');
		}
		return result;
	}
};
