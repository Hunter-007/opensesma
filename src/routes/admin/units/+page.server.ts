import { and, eq, inArray } from 'drizzle-orm';
import { attempt, requireAdmin, str } from '$lib/server/guards';
import {
	addUnit,
	commitHouseholdImport,
	createInvite,
	inviteUrl,
	listUnits,
	parseHouseholdCsv,
	sendInviteSms,
	setDuesStatus
} from '$lib/server/estates';
import { getDb, schema } from '$lib/server/db';
import { AppError, audit } from '$lib/server/util';
import { normalisePhone } from '$lib/shared/phone';
import type { DuesStatus } from '$lib/shared/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const units = await listUnits(a.estateId);
	const db = await getDb();
	const residents = await db
		.select({ unitId: schema.memberships.unitId, name: schema.users.name, role: schema.memberships.role })
		.from(schema.memberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
		.where(and(eq(schema.memberships.estateId, a.estateId), eq(schema.memberships.status, 'active'), inArray(schema.memberships.role, ['resident_primary', 'resident_sub'])));
	const byUnit = new Map<string, string[]>();
	for (const r of residents) if (r.unitId) byUnit.set(r.unitId, [...(byUnit.get(r.unitId) ?? []), r.role === 'resident_primary' ? r.name : r.name]);
	const dues = event.url.searchParams.get('dues');
	return {
		dues,
		units: units
			.filter((u) => !dues || u.duesStatus === dues)
			.map((u) => ({ id: u.id, label: u.label, street: u.street, active: u.active, duesStatus: u.duesStatus, duesNote: u.duesNote, residents: byUnit.get(u.id) ?? [] })),
		total: units.length
	};
};

export const actions: Actions = {
	add: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const unit = await addUnit(a.estateId, str(fd, 'street'), str(fd, 'number'));
			const phone = str(fd, 'phone');
			if (phone) {
				const p = normalisePhone(phone);
				if (!p) throw new AppError('House added, but the phone number looks wrong');
				const inv = await createInvite({ estateId: a.estateId, unitId: unit.id, phone: p, name: str(fd, 'name'), role: 'resident_primary', createdBy: a.user.id });
				await sendInviteSms(inv.code, p, str(fd, 'name'));
				return { ok: `Added ${unit.number} ${unit.street} and texted the invite.`, link: inviteUrl(inv.code) };
			}
			return { ok: `Added ${unit.number} ${unit.street}.` };
		}, Object.fromEntries(fd));
	},
	preview: async (event) => {
		requireAdmin(event);
		const fd = await event.request.formData();
		const file = fd.get('file');
		const text = file instanceof File && file.size ? await file.text() : str(fd, 'csv');
		if (!text) return { error: 'Choose a CSV file or paste the rows' };
		if (text.length > 1_000_000) return { error: 'That file is too big. Split it into parts of under 5,000 houses.' };
		const report = parseHouseholdCsv(text);
		return { preview: { csv: text, valid: report.valid.slice(0, 500), validCount: report.valid.length, errors: report.errors } };
	},
	import: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const report = parseHouseholdCsv(str(fd, 'csv'));
			const res = await commitHouseholdImport(a.estateId, a.user.id, report.valid, fd.get('sendInvites') === 'on');
			return { ok: `Imported ${res.unitsCreated} houses${res.invitesSent ? ` and texted ${res.invitesSent} invites` : ''}.` };
		});
	},
	dues: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			await setDuesStatus(a.estateId, a.user.id, str(fd, 'unitId'), str(fd, 'status') as DuesStatus, str(fd, 'note'));
			return { ok: 'Dues status saved.' };
		});
	},
	invite: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			const p = normalisePhone(str(fd, 'phone'));
			if (!p) throw new AppError('Enter a valid phone number');
			const inv = await createInvite({ estateId: a.estateId, unitId: str(fd, 'unitId'), phone: p, name: str(fd, 'name'), role: 'resident_primary', createdBy: a.user.id });
			await sendInviteSms(inv.code, p, str(fd, 'name'));
			return { ok: 'Invite texted.', link: inviteUrl(inv.code) };
		});
	},
	toggle: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		const db = await getDb();
		const active = str(fd, 'active') === 'true';
		await db.update(schema.units).set({ active }).where(and(eq(schema.units.id, str(fd, 'unitId')), eq(schema.units.estateId, a.estateId)));
		await audit(db, { estateId: a.estateId, actorUserId: a.user.id, action: active ? 'unit.activate' : 'unit.deactivate', entity: 'unit', entityId: str(fd, 'unitId') });
		return { ok: active ? 'House reactivated.' : 'House deactivated. Its passes stop working at the next gate sync.' };
	}
};
