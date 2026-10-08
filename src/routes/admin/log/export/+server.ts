import { requireAdmin } from '$lib/server/guards';
import { eventsToCsv, listEvents } from '$lib/server/admin';
import { parseLogFilter } from '../filters';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const a = requireAdmin(event);
	const f = parseLogFilter(event.url, a.estate.timeZone);
	const rows = await listEvents(a.estateId, { ...f, limit: 5000 });
	const csv = eventsToCsv(rows, a.estate.timeZone);
	const stamp = new Date().toISOString().slice(0, 10);
	return new Response('﻿' + csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="gate-log-${stamp}.csv"`
		}
	});
};
