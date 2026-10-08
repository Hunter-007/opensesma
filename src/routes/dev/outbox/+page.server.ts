import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { devOutbox } from '$lib/server/sms';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (config.isProd || config.smsDriver !== 'console') error(404, 'Not found');
	return { messages: devOutbox.map((m) => ({ ...m, at: m.at.getTime() })) };
};
