import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import { getEstate } from '$lib/server/estates';
import { isLive } from '$lib/server/passes';
import { qrSvg } from '$lib/server/qr';
import { unitLabel } from '$lib/server/util';
import { peekPass, verifyPass } from '$lib/shared/passToken';
import { formatDateTime, formatSchedule } from '$lib/shared/format';
import type { PageServerLoad } from './$types';

// The visitor's page: server-rendered, no JavaScript, a few KB on a data bundle.
export const csr = false;

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const claims = peekPass(params.token);
	if (!claims) error(404, 'This pass link is not valid');
	const estate = await getEstate(claims.estateId).catch(() => null);
	if (!estate || !verifyPass(params.token, estate.signingPublicKey).ok) error(404, 'This pass link is not valid');

	const db = await getDb();
	const [row] = await db
		.select({ pass: schema.passes, unit: schema.units, hostName: schema.users.name })
		.from(schema.passes)
		.innerJoin(schema.units, eq(schema.units.id, schema.passes.unitId))
		.leftJoin(schema.users, eq(schema.users.id, schema.passes.createdBy))
		.where(eq(schema.passes.id, claims.id));
	if (!row || row.pass.token !== params.token) error(404, 'This pass was replaced. Ask your host for the new one.');

	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
	const p = row.pass;
	const tz = estate.timeZone;
	return {
		estateName: estate.name,
		address: estate.address,
		directions: estate.settings.directionsNote,
		unit: unitLabel(row.unit),
		name: p.visitorName,
		code: p.code,
		// First name only, and never the host's phone number: this page goes to
		// whoever the link is forwarded to.
		hostName: (row.hostName ?? '').split(' ')[0],
		when: p.schedule ? formatSchedule(p.schedule) : `${formatDateTime(p.validFrom, tz)}${p.validTo ? ` – ${formatDateTime(p.validTo, tz)}` : ''}`,
		group: p.type === 'event' ? p.maxEntries : 0,
		state: p.status === 'revoked' ? 'cancelled' : isLive(p) ? (p.validFrom > new Date() ? 'upcoming' : 'active') : 'finished',
		qr: await qrSvg(url.href)
	};
};
