import type { LogFilter } from '$lib/server/admin';
import { localToUtc } from '$lib/shared/format';
import type { EventKind, EventMethod } from '$lib/shared/types';

export function parseLogFilter(url: URL, timeZone: string): LogFilter & { fromDate: string; toDate: string } {
	const p = url.searchParams;
	const fromDate = p.get('from') ?? '';
	const toDate = p.get('to') ?? '';
	return {
		fromDate,
		toDate,
		from: fromDate ? (localToUtc(fromDate, '00:00', timeZone) ?? undefined) : undefined,
		to: toDate ? (localToUtc(toDate, '23:59', timeZone) ?? undefined) : undefined,
		unitId: p.get('unit') || undefined,
		gateId: p.get('gate') || undefined,
		kind: (p.get('kind') as EventKind) || undefined,
		method: (p.get('method') as EventMethod) || undefined,
		q: p.get('q') || undefined,
		conflictsOnly: p.get('conflicts') === '1'
	};
}
