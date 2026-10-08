import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { config } from './config';
import { getDb, schema } from './db';
import { randomId } from '../shared/encoding';
import { AppError } from './util';

export interface PushPayload {
	title: string;
	body: string;
	url?: string;
	tag?: string;
	/** Notification action buttons, e.g. approve/deny for walk-ins. */
	actions?: { action: string; title: string }[];
	data?: Record<string, unknown>;
	requireInteraction?: boolean;
}

let configured = false;
const ready = () => {
	if (!config.vapid.publicKey || !config.vapid.privateKey) return false;
	if (!configured) {
		webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
		configured = true;
	}
	return true;
};

export const pushEnabled = () => !!config.vapid.publicKey && !!config.vapid.privateKey;

/** Browser push services. Anything else would make our server call an arbitrary host. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function isAllowedPushEndpoint(endpoint: string): boolean {
	try {
		const u = new URL(endpoint);
		return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
	} catch {
		return false;
	}
}

/**
 * Store a browser's push subscription. A subscription already registered to a
 * different person is never moved — otherwise anyone who learned that address
 * could redirect someone else's alerts to themselves. The browser just makes a
 * fresh subscription instead (see enablePush).
 */
export async function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
	if (!isAllowedPushEndpoint(sub.endpoint)) throw new AppError('Unsupported push service', 400, 'push_endpoint');
	const db = await getDb();
	const [existing] = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, sub.endpoint));
	if (existing && existing.userId !== userId) throw new AppError('This browser is registered to someone else', 409, 'push_taken');
	if (existing) return;
	await db.insert(schema.pushSubscriptions).values({ id: randomId(), userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
}

/** Returns how many devices accepted the message (0 means: fall back to SMS). */
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
	if (!userIds.length || !ready()) return 0;
	const db = await getDb();
	const subs = await db.select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, userIds));
	let delivered = 0;
	await Promise.all(
		subs.map(async (s) => {
			try {
				await webpush.sendNotification(
					{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
					JSON.stringify(payload),
					{ TTL: 300, urgency: 'high' }
				);
				delivered++;
			} catch (err) {
				const code = (err as { statusCode?: number }).statusCode;
				if (code === 404 || code === 410) {
					await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
				}
			}
		})
	);
	return delivered;
}
