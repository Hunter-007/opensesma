import type { Schedule } from './types';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDateTime(d: Date | number | string, timeZone = 'Africa/Lagos'): string {
	return new Intl.DateTimeFormat('en-NG', {
		timeZone,
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	}).format(new Date(d));
}

export function formatTime(d: Date | number | string, timeZone = 'Africa/Lagos'): string {
	return new Intl.DateTimeFormat('en-NG', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}

export function formatSchedule(s: Schedule): string {
	const days = [...s.days].sort((a, b) => a - b);
	let dayText: string;
	const key = days.join(',');
	if (key === '0,1,2,3,4,5,6') dayText = 'Every day';
	else if (key === '1,2,3,4,5') dayText = 'Mon–Fri';
	else if (key === '1,2,3,4,5,6') dayText = 'Mon–Sat';
	else dayText = days.map((d) => DAY[d]).join(', ');
	return s.start === s.end ? `${dayText}, all day` : `${dayText}, ${s.start}–${s.end}`;
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(new Date(utcMs));
	const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs;
}

/** "2026-10-12" + "18:30" in the estate's time zone → a real instant. */
export function localToUtc(date: string, time: string, timeZone: string): Date | null {
	const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	const tm = time.match(/^(\d{2}):(\d{2})$/);
	if (!dm || !tm) return null;
	const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
	let ms = guess - tzOffsetMs(guess, timeZone);
	ms = guess - tzOffsetMs(ms, timeZone); // second pass handles DST edges
	return new Date(ms);
}

/** An instant → { date: "YYYY-MM-DD", time: "HH:MM" } in the estate's time zone (for input defaults). */
export function utcToLocalInputs(d: Date | number, timeZone: string): { date: string; time: string } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).formatToParts(new Date(d));
	const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
	return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

export function relativeTime(d: Date | number | string, now = Date.now()): string {
	const diff = Math.round((new Date(d).getTime() - now) / 1000);
	const abs = Math.abs(diff);
	const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	if (abs < 60) return fmt.format(diff, 'second');
	if (abs < 3600) return fmt.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return fmt.format(Math.round(diff / 3600), 'hour');
	return fmt.format(Math.round(diff / 86400), 'day');
}
