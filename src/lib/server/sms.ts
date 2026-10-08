import { config } from './config';

export interface SmsMessage {
	to: string;
	body: string;
	at: Date;
}

/** In development, messages land here and are shown at /dev/outbox. */
export const devOutbox: SmsMessage[] = [];

export async function sendSms(to: string, body: string): Promise<boolean> {
	const driver = config.smsDriver;
	if (driver === 'termii') return sendTermii(to, body);
	devOutbox.unshift({ to, body, at: new Date() });
	devOutbox.length = Math.min(devOutbox.length, 100);
	if (process.env.VITEST !== 'true') console.info(`[sms → ${to}] ${body}`);
	return true;
}

async function sendTermii(to: string, body: string): Promise<boolean> {
	if (!config.termii.apiKey) {
		console.error('TERMII_API_KEY missing; SMS not sent');
		return false;
	}
	try {
		const res = await fetch('https://api.ng.termii.com/api/sms/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				to: to.replace(/^\+/, ''),
				from: config.termii.senderId,
				sms: body,
				type: 'plain',
				channel: config.termii.channel,
				api_key: config.termii.apiKey
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) console.error('Termii send failed', res.status, await res.text().catch(() => ''));
		return res.ok;
	} catch (err) {
		console.error('Termii send error', err);
		return false;
	}
}
