import { eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/guards';
import { insideNow, listEvents } from '$lib/server/admin';
import { listUnits } from '$lib/server/estates';
import { getDb, schema } from '$lib/server/db';
import { parseLogFilter } from './filters';
import type { PageServerLoad } from './$types';

const PAGE = 100;

export const load: PageServerLoad = async (event) => {
	const a = requireAdmin(event);
	const f = parseLogFilter(event.url, a.estate.timeZone);
	const page = Math.max(0, Number(event.url.searchParams.get('page') ?? 0) || 0);
	const view = event.url.searchParams.get('view') === 'inside' ? 'inside' : 'log';
	const rows = view === 'inside' ? await insideNow(a.estateId) : await listEvents(a.estateId, { ...f, limit: PAGE + 1, offset: page * PAGE });
	const db = await getDb();
	const gates = await db.select({ id: schema.gates.id, name: schema.gates.name }).from(schema.gates).where(eq(schema.gates.estateId, a.estateId));
	return {
		view,
		filter: { from: f.fromDate, to: f.toDate, unit: f.unitId ?? '', gate: f.gateId ?? '', kind: f.kind ?? '', method: f.method ?? '', q: f.q ?? '', conflicts: f.conflictsOnly, flagged: f.flaggedOnly },
		page,
		hasMore: rows.length > PAGE,
		rows: rows.slice(0, PAGE).map((e) => ({
			id: e.id,
			at: e.deviceTs.getTime(),
			kind: e.kind,
			method: e.method,
			type: e.passType,
			visitor: e.visitorName,
			unit: e.unitLabel,
			gate: e.gateName,
			guard: e.guardName,
			reason: e.reason,
			offline: e.offline,
			conflict: e.conflict,
			flag: e.flag
		})),
		units: (await listUnits(a.estateId)).map((u) => ({ id: u.id, label: u.label })),
		gates
	};
};
