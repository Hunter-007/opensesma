import { sql, eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/guards';
import { dashboard } from '$lib/server/admin';
import { getDb, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const d = await dashboard(a.estateId, a.estate.timeZone);
	const db = await getDb();
	const count = async (table: typeof schema.units | typeof schema.devices, col: typeof schema.units.estateId | typeof schema.devices.estateId) =>
		(await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(col, a.estateId)))[0].n;
	const [units, devices] = await Promise.all([count(schema.units, schema.units.estateId), count(schema.devices, schema.devices.estateId)]);
	const [{ guards }] = await db
		.select({ guards: sql<number>`count(*)::int` })
		.from(schema.memberships)
		.where(sql`${schema.memberships.estateId} = ${a.estateId} and ${schema.memberships.role} = 'guard' and ${schema.memberships.status} = 'active'`);
	const [{ residents }] = await db
		.select({ residents: sql<number>`count(*)::int` })
		.from(schema.memberships)
		.where(sql`${schema.memberships.estateId} = ${a.estateId} and ${schema.memberships.role} in ('resident_primary','resident_sub') and ${schema.memberships.status} = 'active'`);
	return {
		...d,
		recentOverrides: d.recentOverrides.map((e) => ({ id: e.id, name: e.visitorName, reason: e.reason, guard: e.guardName, gate: e.gateName, at: e.deviceTs.getTime() })),
		devices: d.devices.map((x) => ({ ...x, lastSyncAt: x.lastSyncAt?.getTime() ?? null })),
		setup: { units, devices, guards, residents },
		welcome: event.url.searchParams.has('welcome')
	};
};
