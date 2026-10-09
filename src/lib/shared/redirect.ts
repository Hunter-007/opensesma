/**
 * Where a user may be sent after signing in. Only same-origin paths under a
 * fixed set of prefixes are allowed; everything else falls back to "/".
 * Parsing with URL (rather than string checks) defeats tricks such as
 * "/\evil.com", "//evil.com", "/%5Cevil.com" or embedded tabs/newlines, which
 * browsers normalise into a different host.
 */
const ALLOWED_PREFIXES = ['/app', '/admin', '/join', '/gate', '/welcome', '/w/', '/l/', '/setup'];

export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/')) return '/';
	const base = 'https://opensesma.invalid';
	let url: URL;
	try {
		url = new URL(next, base);
	} catch {
		return '/';
	}
	if (url.origin !== base) return '/';
	// Reject anything a browser could reinterpret: backslashes, control chars, encoded slashes.
	if (/[\\\u0000-\u001f]/.test(next) || /%(2f|5c)/i.test(next)) return '/';
	const path = url.pathname;
	if (path !== '/' && !ALLOWED_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p.endsWith('/') ? p : p + '/')))
		return '/';
	return path + url.search;
}
