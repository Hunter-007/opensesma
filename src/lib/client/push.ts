import { b64urlToBytes } from '$lib/shared/encoding';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'needs-install';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
		// iOS only exposes web push to installed (home-screen) apps.
		return isIos() && !standalone() ? 'needs-install' : 'unsupported';
	}
	if (Notification.permission === 'denied') return 'denied';
	const reg = await navigator.serviceWorker.getRegistration();
	const sub = await reg?.pushManager.getSubscription();
	return sub ? 'on' : 'off';
}

export async function enablePush(vapidKey: string): Promise<PushState> {
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
	const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/service-worker.js', { type: 'module' }));
	await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(vapidKey) as BufferSource });
	const res = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(sub.toJSON())
	});
	return res.ok ? 'on' : 'off';
}
