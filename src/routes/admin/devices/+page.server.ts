import { and, eq } from 'drizzle-orm';
import { attempt, requireAdmin, str } from '$lib/server/guards';
import { createDevice, regenerateEnrollCode, revokeDevice } from '$lib/server/gate';
import { getDb, schema } from '$lib/server/db';
import { config } from '$lib/server/config';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const db = await getDb();
	const gates = await db.select().from(schema.gates).where(eq(schema.gates.estateId, a.estateId));
	const devices = await db.select().from(schema.devices).where(eq(schema.devices.estateId, a.estateId));
	return {
		gateUrl: `${config.publicUrl}/gate`,
		gates: gates.map((g) => ({ id: g.id, name: g.name })),
		devices: devices
			.filter((d) => !d.revokedAt)
			.map((d) => ({
				id: d.id,
				name: d.name,
				gateId: d.gateId,
				enrollCode: d.enrollCode && d.enrollExpiresAt && d.enrollExpiresAt > new Date() ? d.enrollCode : null,
				enrollExpiresAt: d.enrollExpiresAt?.getTime() ?? null,
				enrolled: !!d.enrolledAt,
				lastSyncAt: d.lastSyncAt?.getTime() ?? null
			}))
	};
};

export const actions: Actions = {
	create: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			await createDevice(a.estateId, a.user.id, str(fd, 'gateId'), str(fd, 'name'));
			return { ok: 'Gate phone added. Enter the setup code on the phone.' };
		});
	},
	reenroll: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			await regenerateEnrollCode(a.estateId, a.user.id, str(fd, 'deviceId'));
			return { ok: 'New setup code made. The old phone is signed out.' };
		});
	},
	revoke: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		return attempt(async () => {
			await revokeDevice(a.estateId, a.user.id, str(fd, 'deviceId'));
			return { ok: 'Phone removed. It is wiped the next time it connects.' };
		});
	},
	addGate: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		const name = str(fd, 'name');
		if (!name) return { error: 'Enter the gate name' };
		const db = await getDb();
		const { randomId } = await import('$lib/shared/encoding');
		await db.insert(schema.gates).values({ id: randomId(10), estateId: a.estateId, name });
		return { ok: `${name} added.` };
	},
	renameGate: async (event) => {
		const a = requireAdmin(event);
		const fd = await event.request.formData();
		const db = await getDb();
		await db
			.update(schema.gates)
			.set({ name: str(fd, 'name') })
			.where(and(eq(schema.gates.id, str(fd, 'gateId')), eq(schema.gates.estateId, a.estateId)));
		return { ok: 'Gate renamed.' };
	}
};
