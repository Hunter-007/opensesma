import { attempt, requireAdmin, str } from '$lib/server/guards';
import { addBan, listBans, removeBan } from '$lib/server/admin';
import { localToUtc } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const bans = await listBans(a.estateId);
	return { bans: bans.map((b) => ({ id: b.id, name: b.name, phone: b.phone, reason: b.reason, createdAt: b.createdAt.getTime(), expiresAt: b.expiresAt?.getTime() ?? null })) };
};

export const actions: Actions = {
	add: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const until = str(fd, 'until');
			await addBan(a.estateId, a.user.id, { name: str(fd, 'name'), phone: str(fd, 'phone'), reason: str(fd, 'reason'), expiresAt: until ? localToUtc(until, '23:59', a.estate.timeZone) : null });
			return { ok: 'Added. Gate phones get it on their next sync.' };
		}, Object.fromEntries(fd));
	},
	remove: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		await removeBan(a.estateId, a.user.id, str(fd, 'banId'));
		return { ok: 'Removed from the ban list.' };
	}
};
