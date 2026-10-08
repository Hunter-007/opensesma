import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { config } from './config';
import { getDb, schema } from './db';
import { randomId } from '../shared/encoding';

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

export async function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
	const db = await getDb();
	await db
		.insert(schema.pushSubscriptions)
		.values({ id: randomId(), userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
		.onConflictDoUpdate({
			target: schema.pushSubscriptions.endpoint,
			set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth }
		});
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
