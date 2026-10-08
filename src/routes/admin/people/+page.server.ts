import { attempt, requireAdmin, str } from '$lib/server/guards';
import { listMembers } from '$lib/server/admin';
import { addStaffAccount, decideMembership, deactivateMember, resetGuardPin } from '$lib/server/estates';
import { AppError } from '$lib/server/util';
import type { Role } from '$lib/shared/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const members = await listMembers(a.estateId);
	const sorted = members.sort((x, y) => x.unitLabel.localeCompare(y.unitLabel, undefined, { numeric: true }) || x.name.localeCompare(y.name));
	return {
		pending: sorted.filter((m) => m.status === 'pending').map((m) => ({ ...m, createdAt: m.createdAt.getTime() })),
		staff: sorted.filter((m) => m.status === 'active' && ['guard', 'security_officer', 'estate_admin'].includes(m.role)).map((m) => ({ ...m, createdAt: m.createdAt.getTime() })),
		residents: sorted.filter((m) => m.status === 'active' && (m.role === 'resident_primary' || m.role === 'resident_sub')).map((m) => ({ ...m, createdAt: m.createdAt.getTime() })),
		canManageAdmins: a.membership.role === 'estate_admin'
	};
};

export const actions: Actions = {
	decide: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const approve = str(fd, 'decision') === 'approve';
			await decideMembership(a.estateId, a.user.id, str(fd, 'membershipId'), approve);
			return { ok: approve ? 'Approved. We texted them.' : 'Request declined.' };
		});
	},
	addStaff: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const role = str(fd, 'role') as Extract<Role, 'guard' | 'security_officer' | 'estate_admin'>;
			if (!['guard', 'security_officer', 'estate_admin'].includes(role)) throw new AppError('Choose a role');
			if (role !== 'guard' && a.membership.role !== 'estate_admin') throw new AppError('Only the estate manager can add managers and security officers', 403);
			if (!str(fd, 'name')) throw new AppError('Enter their name');
			await addStaffAccount({ estateId: a.estateId, actorUserId: a.user.id, phone: str(fd, 'phone'), name: str(fd, 'name'), role, pin: str(fd, 'pin') || undefined });
			return { ok: role === 'guard' ? 'Guard added. Tap Sync on the gate phone and they can start a shift with their PIN.' : 'Added. They sign in with their phone number.' };
		}, Object.fromEntries(fd));
	},
	pin: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			await resetGuardPin(a.estateId, a.user.id, str(fd, 'membershipId'), str(fd, 'pin'));
			return { ok: 'PIN changed. It works on the gate phone after its next sync.' };
		});
	},
	remove: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const id = str(fd, 'membershipId');
			const members = await listMembers(a.estateId);
			const m = members.find((x) => x.id === id);
			if (!m) throw new AppError('Not found', 404);
			if (m.userId === a.user.id) throw new AppError("You can't remove yourself");
			if (m.role === 'estate_admin' && a.membership.role !== 'estate_admin') throw new AppError('Only the estate manager can remove a manager', 403);
			await deactivateMember(a.estateId, a.user.id, id);
			return { ok: `${m.name || 'Member'} removed. Their passes were cancelled.` };
		});
	}
};
