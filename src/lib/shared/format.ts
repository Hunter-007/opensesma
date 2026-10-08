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

export function relativeTime(d: Date | number | string, now = Date.now()): string {
	const diff = Math.round((new Date(d).getTime() - now) / 1000);
	const abs = Math.abs(diff);
	const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	if (abs < 60) return fmt.format(diff, 'second');
	if (abs < 3600) return fmt.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return fmt.format(Math.round(diff / 3600), 'hour');
	return fmt.format(Math.round(diff / 86400), 'day');
}
