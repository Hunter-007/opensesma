import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, schema } from './db';
import { hmac, randomToken, safeEqual, sha256 } from './crypto';
import { sendSms } from './sms';
import { AppError, rateLimit } from './util';
import { config } from './config';
import { randomId } from '../shared/encoding';
import { normalisePhone } from '../shared/phone';

export const SESSION_COOKIE = 'os_session';
export const SESSION_DAYS = 30;
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_SECONDS = 60;

const otpHash = (phone: string, code: string) => hmac(`otp:${phone}:${code}`);

function otpCode(): string {
	const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	return String(n).padStart(6, '0');
}

/** Sends a login OTP. Returns the code itself only in development (DEV_SHOW_OTP). */
export async function requestOtp(rawPhone: string, ctx: { ip?: string } = {}): Promise<{ phone: string; devCode?: string }> {
	const phone = normalisePhone(rawPhone);
	if (!phone) throw new AppError('Enter a valid phone number, e.g. 0803 123 4567');
	// SMS pumping defence: only countries the estate operates in, and limits per
	// sender IP and across the whole service, not just per destination number.
	if (!config.allowedCountryCodes.some((cc) => phone.startsWith('+' + cc)))
		throw new AppError('Sign-in is only available for Nigerian phone numbers', 400, 'country_not_allowed');
	if (ctx.ip) {
		if (!(await rateLimit(`otp:ip:h:${ctx.ip}`, config.otpPerIpPerHour, 3600)))
			throw new AppError('Too many sign-in attempts from this network. Try again later', 429, 'rate_limited');
		if (!(await rateLimit(`otp:ip:d:${ctx.ip}`, config.otpPerIpPerHour * 4, 86_400)))
			throw new AppError('Too many sign-in attempts from this network. Try again tomorrow', 429, 'rate_limited');
	}
	if (!(await rateLimit('otp:global:h', config.otpGlobalPerHour, 3600))) {
		console.error('[security] global OTP hourly cap reached — possible SMS pumping');
		throw new AppError('Sign-in codes are temporarily unavailable. Please try again shortly', 503, 'otp_capacity');
	}
	if (!(await rateLimit(`otp:cool:${phone}`, 1, OTP_RESEND_SECONDS)))
		throw new AppError('Please wait a minute before requesting another code', 429, 'rate_limited');
	if (!(await rateLimit(`otp:hour:${phone}`, 5, 3600)))
		throw new AppError('Too many codes requested. Try again in an hour', 429, 'rate_limited');

	const code = otpCode();
	const db = await getDb();
	await db.insert(schema.otps).values({
		id: randomId(),
		phone,
		codeHash: otpHash(phone, code),
		expiresAt: new Date(Date.now() + OTP_TTL_MS)
	});
	await sendSms(phone, `Your OpenSesma code is ${code}. It expires in 5 minutes. Don't share it with anyone.`);
	return { phone, devCode: config.devShowOtp ? code : undefined };
}

/** Verifies the OTP, creates the user if new, and returns a session token. */
export async function verifyOtp(rawPhone: string, code: string, ctx: { ip?: string } = {}): Promise<{ token: string; userId: string; isNew: boolean }> {
	const phone = normalisePhone(rawPhone);
	if (!phone || !/^\d{6}$/.test(code.trim())) throw new AppError('Enter the 6-digit code we sent you');
	if (ctx.ip && !(await rateLimit(`otp:verify:ip:${ctx.ip}`, 30, 3600)))
		throw new AppError('Too many attempts from this network. Try again later', 429, 'rate_limited');
	const db = await getDb();
	const [otp] = await db
		.select()
		.from(schema.otps)
		.where(and(eq(schema.otps.phone, phone), isNull(schema.otps.consumedAt), gt(schema.otps.expiresAt, new Date())))
		.orderBy(desc(schema.otps.createdAt))
		.limit(1);
	if (!otp) throw new AppError('That code has expired. Request a new one', 400, 'otp_expired');
	if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('Too many wrong attempts. Request a new code', 400, 'otp_locked');

	if (!safeEqual(otp.codeHash, otpHash(phone, code.trim()))) {
		await db.update(schema.otps).set({ attempts: otp.attempts + 1 }).where(eq(schema.otps.id, otp.id));
		const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
		throw new AppError(left > 0 ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left` : 'Wrong code. Request a new one', 400, 'otp_wrong');
	}
	await db.update(schema.otps).set({ consumedAt: new Date() }).where(eq(schema.otps.id, otp.id));

	let [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
	const isNew = !user;
	if (!user) {
		[user] = await db.insert(schema.users).values({ id: randomId(), phone }).returning();
	}
	return { token: await createSession(user.id), userId: user.id, isNew };
}

export async function createSession(userId: string, activeEstateId: string | null = null): Promise<string> {
	const db = await getDb();
	const token = randomToken();
	await db.insert(schema.sessions).values({
		id: sha256(token),
		userId,
		activeEstateId,
		expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000)
	});
	return token;
}

export async function destroySession(token: string) {
	const db = await getDb();
	await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
}

export async function setActiveEstate(token: string, estateId: string) {
	const db = await getDb();
	await db.update(schema.sessions).set({ activeEstateId: estateId }).where(eq(schema.sessions.id, sha256(token)));
}

export type SessionContext = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

/** Resolves the cookie to the user, their active estate membership, and the estate. */
export async function loadSession(token: string | undefined) {
	if (!token) return null;
	const db = await getDb();
	const [row] = await db
		.select({ session: schema.sessions, user: schema.users })
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(eq(schema.sessions.id, sha256(token)))
		.limit(1);
	if (!row) return null;
	if (row.session.expiresAt < new Date()) {
		await destroySession(token);
		return null;
	}
	// Sliding expiry: refresh when less than half the lifetime is left.
	if (row.session.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
		await db
			.update(schema.sessions)
			.set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) })
			.where(eq(schema.sessions.id, row.session.id));
	}

	const memberships = await db
		.select({ membership: schema.memberships, estate: schema.estates, unit: schema.units })
		.from(schema.memberships)
		.innerJoin(schema.estates, eq(schema.estates.id, schema.memberships.estateId))
		.leftJoin(schema.units, eq(schema.units.id, schema.memberships.unitId))
		.where(eq(schema.memberships.userId, row.user.id));

	const active =
		memberships.find((m) => m.estate.id === row.session.activeEstateId && m.membership.status === 'active') ??
		memberships.find((m) => m.membership.status === 'active') ??
		null;

	return { user: row.user, session: row.session, memberships, active };
}
