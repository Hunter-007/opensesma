/**
 * Sign-in without SMS. The estate manager sends a member a one-time link on
 * WhatsApp or by text; opening it and tapping "Sign in" starts a session.
 *
 * Rules:
 * - Only a hash of the token is stored. Links work once and expire after 3 days.
 * - Making a new link for someone cancels their older unused links.
 * - The link page is a GET that changes nothing; signing in is a POST, so
 *   WhatsApp's link preview can't use up the link.
 * - A manager can only issue links for people whose memberships are all in
 *   their own estate. Otherwise a manager of estate A could take over the
 *   account of someone who also manages estate B.
 */
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { getDb, schema, type DB } from './db';
import { config } from './config';
import { randomToken, sha256 } from './crypto';
import { createSession } from './auth';
import { acceptInvite, findInvite, upsertUser } from './estates';
import { AppError, audit, rateLimit } from './util';

export const SIGN_IN_LINK_HOURS = 72;
export const signInUrl = (token: string) => `${config.publicUrl}/l/${token}`;

/** True when the user has no active or pending membership outside this estate. */
async function belongsOnlyTo(db: DB, userId: string, estateId: string) {
	const others = await db
		.select({ id: schema.memberships.id })
		.from(schema.memberships)
		.where(and(eq(schema.memberships.userId, userId), ne(schema.memberships.estateId, estateId), ne(schema.memberships.status, 'disabled')))
		.limit(1);
	return others.length === 0;
}

const OTHER_ESTATE = "This person also belongs to another estate on OpenSesma, so a sign-in link can't be made for them here.";

export async function createSignInLink(estateId: string, actorUserId: string, membershipId: string) {
	const db = await getDb();
	const [row] = await db
		.select({ m: schema.memberships, user: schema.users, estate: schema.estates })
		.from(schema.memberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
		.innerJoin(schema.estates, eq(schema.estates.id, schema.memberships.estateId))
		.where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.estateId, estateId)));
	if (!row || row.m.status !== 'active') throw new AppError('Member not found', 404, 'not_found');
	if (!(await belongsOnlyTo(db, row.user.id, estateId))) throw new AppError(OTHER_ESTATE, 409, 'other_estate');
	if (!(await rateLimit(`signin-links:${actorUserId}`, 60, 3600))) throw new AppError('Too many sign-in links in the last hour. Try again later', 429, 'rate_limited');

	const now = new Date();
	// Older unused links for this person stop working.
	await db
		.update(schema.loginLinks)
		.set({ usedAt: now })
		.where(and(eq(schema.loginLinks.userId, row.user.id), eq(schema.loginLinks.estateId, estateId), isNull(schema.loginLinks.usedAt)));

	const token = randomToken(24);
	const expiresAt = new Date(now.getTime() + SIGN_IN_LINK_HOURS * 3_600_000);
	await db.insert(schema.loginLinks).values({ id: sha256(token), estateId, userId: row.user.id, createdBy: actorUserId, expiresAt });
	await audit(db, { estateId, actorUserId, action: 'signin_link.create', entity: 'user', entityId: row.user.id });

	const url = signInUrl(token);
	return { url, expiresAt, name: row.user.name, phone: row.user.phone, message: signInMessage(row.user.name, row.estate.name, url) };
}

export function signInMessage(name: string, estateName: string, url: string) {
	const first = name.trim().split(' ')[0];
	return [
		first ? `Hi ${first},` : 'Hello,',
		`here is your sign-in link for ${estateName} on OpenSesma:`,
		url,
		'',
		`It works once and expires in ${SIGN_IN_LINK_HOURS / 24} days. Don't forward it — anyone with the link can sign in as you.`
	].join('\n');
}

export async function findSignInLink(token: string) {
	if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
	const db = await getDb();
	const [row] = await db
		.select({ link: schema.loginLinks, user: schema.users, estate: schema.estates })
		.from(schema.loginLinks)
		.innerJoin(schema.users, eq(schema.users.id, schema.loginLinks.userId))
		.innerJoin(schema.estates, eq(schema.estates.id, schema.loginLinks.estateId))
		.where(and(eq(schema.loginLinks.id, sha256(token)), isNull(schema.loginLinks.usedAt), gt(schema.loginLinks.expiresAt, new Date())));
	return row ? { name: row.user.name, estateName: row.estate.name } : null;
}

/** Uses the link (once) and returns a new session token. */
export async function useSignInLink(token: string, ctx: { ip?: string } = {}) {
	if (ctx.ip && !(await rateLimit(`signin-link-use:${ctx.ip}`, 30, 3600)))
		throw new AppError('Too many attempts from this network. Try again later', 429, 'rate_limited');
	const expired = new AppError('This sign-in link has expired or was already used. Ask your estate manager for a new one.', 400, 'link_invalid');
	if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw expired;
	const db = await getDb();
	// Claim the link atomically so two taps can't both sign in.
	const [link] = await db
		.update(schema.loginLinks)
		.set({ usedAt: new Date() })
		.where(and(eq(schema.loginLinks.id, sha256(token)), isNull(schema.loginLinks.usedAt), gt(schema.loginLinks.expiresAt, new Date())))
		.returning();
	if (!link) throw expired;
	const [m] = await db
		.select({ status: schema.memberships.status })
		.from(schema.memberships)
		.where(and(eq(schema.memberships.userId, link.userId), eq(schema.memberships.estateId, link.estateId)));
	if (!m || m.status !== 'active') throw new AppError('Your access to this estate has ended. Contact your estate manager.', 403, 'not_member');
	if (!(await belongsOnlyTo(db, link.userId, link.estateId))) throw new AppError(OTHER_ESTATE, 409, 'other_estate');
	await audit(db, { estateId: link.estateId, actorUserId: link.userId, action: 'signin_link.use', entity: 'user', entityId: link.userId, data: { issuedBy: link.createdBy } });
	return createSession(link.userId, link.estateId);
}

/**
 * Accepting an invite link signs the person in, for invites made out to a
 * phone number. The invite is a one-time bearer link like a sign-in link.
 */
export async function acceptInviteAndSignIn(code: string, name: string, ctx: { ip?: string } = {}) {
	if (ctx.ip && !(await rateLimit(`signin-link-use:${ctx.ip}`, 30, 3600)))
		throw new AppError('Too many attempts from this network. Try again later', 429, 'rate_limited');
	const found = await findInvite(code);
	if (!found) throw new AppError('This invite link has expired or was already used. Ask your estate manager for a new one.', 400, 'invite_invalid');
	if (!found.invite.phone) throw new AppError('This invite has no phone number. Ask your estate manager for a new one.', 400, 'invite_invalid');
	const db = await getDb();
	const user = await upsertUser(found.invite.phone, name.trim() || found.invite.name);
	if (!(await belongsOnlyTo(db, user.id, found.invite.estateId))) throw new AppError(OTHER_ESTATE, 409, 'other_estate');
	const estate = await acceptInvite(code, user, name);
	return { session: await createSession(user.id, estate.id), estate };
}
