import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import { attempt, requireResident, str } from '$lib/server/guards';
import { addHouseholdMember, deactivateMember } from '$lib/server/estates';
import { addStaffProfile, removeStaffProfile } from '$lib/server/passes';
import { AppError } from '$lib/server/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const r = requireResident(event);
	const db = await getDb();
	const members = await db
		.select({ id: schema.memberships.id, userId: schema.users.id, name: schema.users.name, phone: schema.users.phone, role: schema.memberships.role, status: schema.memberships.status })
		.from(schema.memberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
		.where(eq(schema.memberships.unitId, r.unit.id));
	const invites = await db
		.select({ id: schema.invites.id, name: schema.invites.name, phone: schema.invites.phone })
		.from(schema.invites)
		.where(and(eq(schema.invites.unitId, r.unit.id), isNull(schema.invites.usedAt), gt(schema.invites.expiresAt, new Date()), eq(schema.invites.role, 'resident_sub')));
	const staff = await db
		.select({ profile: schema.staffProfiles, pass: schema.passes })
		.from(schema.staffProfiles)
		.leftJoin(schema.passes, and(eq(schema.passes.staffProfileId, schema.staffProfiles.id), eq(schema.passes.status, 'active')))
		.where(and(eq(schema.staffProfiles.unitId, r.unit.id), eq(schema.staffProfiles.active, true)));
	return {
		isPrimary: r.membership.role === 'resident_primary',
		members: members.filter((m) => m.status !== 'disabled'),
		invites,
		staff: staff.map((s) => ({
			id: s.profile.id,
			name: s.profile.name,
			role: s.profile.role,
			phone: s.profile.phone,
			passId: s.pass?.id ?? null,
			code: s.pass?.code ?? null,
			schedule: s.pass?.schedule ?? null
		}))
	};
};

const requirePrimary = (r: ReturnType<typeof requireResident>) => {
	if (r.membership.role !== 'resident_primary') throw new AppError('Only the head of the household can do this', 403);
};

export const actions: Actions = {
	addMember: async (event) => {
		const r = requireResident(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			requirePrimary(r);
			if (!str(fd, 'name')) throw new AppError('Enter their name');
			await addHouseholdMember({ estateId: r.estate.id, unitId: r.unit.id, actorUserId: r.user.id, phone: str(fd, 'phone'), name: str(fd, 'name') });
			return { ok: 'Invite sent by SMS. They join by opening the link.' };
		}, Object.fromEntries(fd));
	},
	removeMember: async (event) => {
		const r = requireResident(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			requirePrimary(r);
			const id = str(fd, 'membershipId');
			if (id === r.membership.id) throw new AppError("You can't remove yourself");
			const db = await getDb();
			const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.id, id), eq(schema.memberships.unitId, r.unit.id)));
			if (!m) throw new AppError('Member not found', 404);
			await deactivateMember(r.estate.id, r.user.id, id);
			return { ok: 'Removed. Their passes were cancelled.' };
		});
	},
	addStaff: async (event) => {
		const r = requireResident(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const days = fd.getAll('days').map(Number);
			await addStaffProfile(r.actor, {
				name: str(fd, 'name'),
				phone: str(fd, 'phone') || undefined,
				role: str(fd, 'role'),
				idType: str(fd, 'idType'),
				idNumber: str(fd, 'idNumber'),
				schedule: { days, start: str(fd, 'start'), end: str(fd, 'end') }
			});
			return { ok: 'Staff added. Their code works on their schedule from now on.' };
		}, Object.fromEntries(fd));
	},
	removeStaff: async (event) => {
		const r = requireResident(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			await removeStaffProfile(r.actor, str(fd, 'profileId'));
			return { ok: 'Staff removed and their pass cancelled.' };
		});
	}
};
