import type { Handle, HandleServerError } from '@sveltejs/kit';
import { SESSION_COOKIE, loadSession } from '$lib/server/auth';
import { AppError } from '$lib/server/util';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.auth = token ? await loadSession(token) : null;
	if (token && !event.locals.auth) event.cookies.delete(SESSION_COOKIE, { path: '/' });

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	return response;
};

export const handleError: HandleServerError = ({ error, status }) => {
	if (error instanceof AppError) return { message: error.message, code: error.code };
	if (status !== 404) console.error(error);
	return { message: status === 404 ? 'Page not found' : 'Something went wrong on our side. Please try again.' };
};
