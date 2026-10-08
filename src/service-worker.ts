/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `opensesma-${version}`;
// App code, static files, and the prerendered guard console shell.
const PRECACHE = [...build, ...files.filter((f) => !f.endsWith('.DS_Store')), ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== location.origin) return;
	if (url.pathname.startsWith('/api/')) return; // always live

	const precached = PRECACHE.includes(url.pathname);
	const isGate = url.pathname === '/gate' || url.pathname.startsWith('/gate?');

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Immutable build files and the gate shell: cache first, so the gate opens with no signal.
			if (precached || isGate) {
				const hit = await cache.match(isGate ? '/gate' : url.pathname);
				if (hit) return hit;
			}
			try {
				const res = await fetch(req);
				return res;
			} catch {
				const fallback = await cache.match(url.pathname);
				if (fallback) return fallback;
				if (req.mode === 'navigate') {
					return new Response(
						'<!doctype html><meta name=viewport content="width=device-width"><title>Offline</title><body style="font-family:system-ui;padding:24px"><h1>No connection</h1><p>You\'re offline. Passes you already shared still work at the gate. Try again when you have data.</p><p><a href="/gate">Open the guard console</a></p>',
						{ headers: { 'content-type': 'text/html; charset=utf-8' } }
					);
				}
				return new Response('offline', { status: 503 });
			}
		})()
	);
});

// ---------------------------------------------------------------- notifications

interface PushPayload {
	title: string;
	body: string;
	url?: string;
	tag?: string;
	actions?: { action: string; title: string }[];
	data?: Record<string, unknown>;
	requireInteraction?: boolean;
}

sw.addEventListener('push', (event) => {
	let p: PushPayload;
	try {
		p = event.data?.json() as PushPayload;
	} catch {
		p = { title: 'OpenSesma', body: event.data?.text() ?? '' };
	}
	event.waitUntil(
		sw.registration.showNotification(p.title, {
			body: p.body,
			tag: p.tag,
			icon: '/icon-192.png',
			badge: '/badge-72.png',
			requireInteraction: p.requireInteraction,
			data: { url: p.url ?? '/app', ...(p.data ?? {}) },
			// @ts-expect-error actions is supported in Chromium-based browsers
			actions: p.actions
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	const n = event.notification;
	const data = (n.data ?? {}) as { url: string; walkinId?: string };
	n.close();
	event.waitUntil(
		(async () => {
			if (data.walkinId && (event.action === 'approve' || event.action === 'deny')) {
				try {
					const res = await fetch(`/api/walkins/${data.walkinId}/decide`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ decision: event.action })
					});
					const body = await res.json();
					const title = !res.ok
						? 'Could not send your answer'
						: body.already
							? `Already answered by ${body.by}`
							: event.action === 'approve'
								? 'Guard told to let them in'
								: 'Guard told to decline';
					await sw.registration.showNotification(title, { tag: n.tag, body: res.ok ? '' : 'Open the app to answer.', data: { url: data.url } });
					return;
				} catch {
					/* fall through to opening the app */
				}
			}
			const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const existing = all.find((c) => new URL(c.url).origin === location.origin);
			if (existing) {
				await existing.focus();
				await (existing as WindowClient).navigate(data.url).catch(() => {});
			} else {
				await sw.clients.openWindow(data.url);
			}
		})()
	);
});
