import { error, fail, json, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { AppError } from './util';
import { SESSION_COOKIE, SESSION_DAYS } from './auth';
import { isAdminRole, isResidentRole } from '../shared/types';
import { config } from './config';

export function requireUser(event: Pick<RequestEvent, 'locals' | 'url'>) {
	const auth = event.locals.auth;
	if (!auth) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	return auth;
}

/** Resident with an active membership attached to a house. */
export function requireResident(event: Pick<RequestEvent, 'locals' | 'url'>) {
	const auth = requireUser(event);
	const active = auth.active;
	if (!active || !isResidentRole(active.membership.role) || !active.unit) redirect(303, '/welcome');
	return {
		auth,
		user: auth.user,
		membership: active.membership,
		estate: active.estate,
		unit: active.unit,
		actor: { userId: auth.user.id, estateId: active.estate.id, unitId: active.unit.id }
	};
}

export function requireAdmin(event: Pick<RequestEvent, 'locals' | 'url'>) {
	const auth = requireUser(event);
	const active = auth.active;
	if (!active || !isAdminRole(active.membership.role)) redirect(303, '/welcome');
	return { auth, user: auth.user, membership: active.membership, estate: active.estate, estateId: active.estate.id };
}

export function setSessionCookie(cookies: Cookies, token: string) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.isProd,
		maxAge: SESSION_DAYS * 86_400
	});
}

/** Wrap a form action body: AppErrors become `fail()` with a message the page shows. */
export async function attempt<T>(fn: () => Promise<T>, values: Record<string, unknown> = {}) {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof AppError) return fail(e.status, { error: e.message, code: e.code, values });
		throw e;
	}
}

/** Wrap a JSON endpoint body. */
export async function api(fn: () => Promise<unknown>) {
	try {
		return json(await fn());
	} catch (e) {
		if (e instanceof AppError) return json({ error: e.message, code: e.code }, { status: e.status });
		throw e;
	}
}

export function notFound(message = 'Not found'): never {
	error(404, message);
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
