import { redirect } from '@sveltejs/kit';
import { attempt, requireResident, str } from '$lib/server/guards';
import { createPass, type CreatePassInput } from '$lib/server/passes';
import { AppError } from '$lib/server/util';
import { localToUtc, utcToLocalInputs } from '$lib/shared/format';
import { PASS_TYPES, type PassType } from '$lib/shared/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const r = requireResident(event);
	const t = event.url.searchParams.get('type');
	if (t === 'staff') redirect(303, '/app/household#staff');
	const now = utcToLocalInputs(new Date(), r.estate.timeZone);
	const tomorrow = utcToLocalInputs(new Date(Date.now() + 86_400_000), r.estate.timeZone);
	return {
		type: (PASS_TYPES as readonly string[]).includes(t ?? '') ? (t as PassType) : 'guest',
		today: now.date,
		tomorrow: tomorrow.date,
		nowTime: now.time,
		prefill: { name: event.url.searchParams.get('name') ?? '', phone: event.url.searchParams.get('phone') ?? '' }
	};
};

export const actions: Actions = {
	default: async (event) => {
		const r = requireResident(event);
		const fd = await event.request.formData();
		const values = Object.fromEntries(fd) as Record<string, string>;
		const tz = r.estate.timeZone;
		const type = str(fd, 'type') as PassType;

		const at = (dateKey: string, timeKey: string, fallbackTime = '00:00') => {
			const d = str(fd, dateKey);
			if (!d) return undefined;
			const when = localToUtc(d, str(fd, timeKey) || fallbackTime, tz);
			if (!when) throw new AppError('Check the date and time');
			return when;
		};

		const result = await attempt(async () => {
			const input: CreatePassInput = {
				type,
				visitorName: str(fd, 'name'),
				visitorPhone: str(fd, 'phone') || undefined,
				purpose: str(fd, 'purpose'),
				sendSms: fd.get('sms') === 'on'
			};
			switch (type) {
				case 'guest': {
					if (str(fd, 'when') === 'later') {
						input.validFrom = at('date', 'time');
						if (!input.validFrom) throw new AppError('Choose when your guest is coming');
					}
					break;
				}
				case 'multiday':
					input.validFrom = at('fromDate', 'x', '00:00') ?? new Date();
					input.validTo = at('toDate', 'x', '23:59');
					break;
				case 'artisan':
					input.validFrom = at('date', 'start', '07:00');
					input.validTo = at('date', 'end', '18:00');
					break;
				case 'event':
					input.validFrom = at('date', 'start', '12:00');
					input.validTo = at('date', 'end', '23:59');
					// An event that runs past midnight ends the next day.
					if (input.validFrom && input.validTo && input.validTo <= input.validFrom)
						input.validTo = new Date(input.validTo.getTime() + 86_400_000);
					input.maxEntries = Number(str(fd, 'guests')) || 0;
					break;
			}
			// Starting "today" at an earlier hour than now should start now.
			if (input.validFrom && input.validFrom < new Date() && type !== 'event') input.validFrom = new Date();
			return createPass(r.actor, input);
		}, values);

		if ('id' in result) redirect(303, `/app/passes/${result.id}?new=1`);
		return result;
	}
};
