// Read env lazily via process.env so the same modules work inside SvelteKit,
// in tsx scripts (migrate/seed) and in vitest.

const env = (k: string) => process.env[k] ?? '';

// Vite sets import.meta.env.PROD in the production server bundle. Hosts such as
// Netlify Functions don't set NODE_ENV=production at runtime, so relying on
// NODE_ENV alone would run production in development mode (OTPs on screen,
// /dev/outbox open, insecure cookies). Scripts and tests have no Vite env.
const builtForProduction = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

export const config = {
	get isProd() {
		return process.env.NODE_ENV === 'production' || builtForProduction;
	},
	get appSecret(): string {
		const s = env('APP_SECRET');
		if (s && s !== 'change-me-to-a-long-random-string') return s;
		if (this.isProd) throw new Error('APP_SECRET must be set in production');
		return 'dev-only-insecure-secret-do-not-use-in-production';
	},
	get publicUrl() {
		return (env('PUBLIC_APP_URL') || env('URL') || 'http://localhost:5173').replace(/\/$/, '');
	},
	get smsDriver() {
		return env('SMS_DRIVER') || 'console';
	},
	termii: {
		get apiKey() {
			return env('TERMII_API_KEY');
		},
		get senderId() {
			return env('TERMII_SENDER_ID') || 'OpenSesma';
		},
		get channel() {
			return env('TERMII_CHANNEL') || 'dnd';
		}
	},
	vapid: {
		get publicKey() {
			return env('VAPID_PUBLIC_KEY');
		},
		get privateKey() {
			return env('VAPID_PRIVATE_KEY');
		},
		get subject() {
			return env('VAPID_SUBJECT') || 'mailto:admin@example.com';
		}
	},
	get devShowOtp() {
		return !this.isProd && env('DEV_SHOW_OTP') !== 'false';
	},
	get cronSecret() {
		return env('CRON_SECRET');
	}
};
