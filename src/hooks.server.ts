import type { Handle, HandleServerError } from '@sveltejs/kit';
import { SESSION_COOKIE, loadSession } from '$lib/server/auth';
import { AppError } from '$lib/server/util';
import { config } from '$lib/server/config';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.auth = token ? await loadSession(token) : null;
	if (token && !event.locals.auth) event.cookies.delete(SESSION_COOKIE, { path: '/' });

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	if (config.isProd) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	return response;
};

export const handleError: HandleServerError = ({ error, status }) => {
	if (error instanceof AppError) return { message: error.message, code: error.code };
	if (status !== 404) console.error(error);
	return { message: status === 404 ? 'Page not found' : 'Something went wrong on our side. Please try again.' };
};
