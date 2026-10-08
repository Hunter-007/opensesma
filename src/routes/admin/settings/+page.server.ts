import { attempt, requireAdmin, str } from '$lib/server/guards';
import { updateSettings } from '$lib/server/estates';
import { listAudit } from '$lib/server/admin';
import { AppError } from '$lib/server/util';
import { PASS_TYPES, type LevyRule, type PassType } from '$lib/shared/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const audit = await listAudit(a.estateId, 30);
	return {
		audit: audit.map((r) => ({ id: r.a.id, action: r.a.action, actor: r.actorName ?? 'System / gate', at: r.a.createdAt.getTime() }))
	};
};

const num = (fd: FormData, k: string, min: number, max: number) => {
	const n = Number(str(fd, k));
	if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`${k} must be between ${min} and ${max}`);
	return n;
};

export const actions: Actions = {
	default: async (event) => {
		const a = requireAdmin(event);
		if (a.membership.role !== 'estate_admin') return { error: 'Only the estate manager can change settings' };
		const fd = await event.request.formData();
		return attempt(async () => {
			const enabled = new Set(fd.getAll('types').map(String));
			const levy = str(fd, 'levyRule') as LevyRule;
			if (!['off', 'warn', 'restrict'].includes(levy)) throw new AppError('Choose a levy rule');
			await updateSettings(a.estateId, a.user.id, {
				name: str(fd, 'name') || undefined,
				address: str(fd, 'address'),
				levyRule: levy,
				disabledPassTypes: PASS_TYPES.filter((t) => t !== 'staff' && !enabled.has(t)) as PassType[],
				guestWindowHours: num(fd, 'guestWindowHours', 1, 48),
				deliveryWindowHours: num(fd, 'deliveryWindowHours', 1, 12),
				maxSubResidents: num(fd, 'maxSubResidents', 0, 20),
				maxActivePassesPerUnit: num(fd, 'maxActivePassesPerUnit', 5, 500),
				staleSyncHours: num(fd, 'staleSyncHours', 1, 72),
				retentionMonths: num(fd, 'retentionMonths', 1, 60),
				directionsNote: str(fd, 'directionsNote').slice(0, 200)
			});
			return { ok: 'Settings saved.' };
		});
	}
};
