// Daily housekeeping: strips visitor personal data past the estate's retention
// period (NDPA) and clears expired OTPs/sessions. Set CRON_SECRET in Netlify env.
export default async () => {
	const base = process.env.URL;
	const secret = process.env.CRON_SECRET;
	if (!base || !secret) return new Response('URL or CRON_SECRET missing', { status: 500 });
	const res = await fetch(`${base}/api/cron/maintenance`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
	return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: '@daily' };
