/**
 * Demo data for local development: an estate with two gates, a few houses,
 * a resident, a guard, a gate phone and some passes and gate history.
 *   npm run db:seed
 * Then sign in with the phone numbers printed below (OTP shows on screen in dev).
 */
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../src/lib/server/db';
import { createEstate, addUnit, addStaffAccount, acceptInvite, createInvite, upsertUser, setDuesStatus } from '../src/lib/server/estates';
import { createPass, addStaffProfile } from '../src/lib/server/passes';
import { createDevice, ingestEvents, authDevice, enrollDevice } from '../src/lib/server/gate';

const db = await getDb();
const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.estates);
if (n > 0) {
	console.log('Database already has an estate; not seeding. Delete ./.data to start fresh.');
	process.exit(0);
}

const { estate, gates, admin } = await createEstate({
	name: 'Harmony Gardens Estate',
	address: 'Off Lekki–Epe Expressway, Sangotedo, Lagos',
	gateNames: ['Main gate', 'Back gate'],
	admin: { phone: '08030000001', name: 'Mrs Funmi Adebayo' },
	settings: { directionsNote: 'After Shoprite Sangotedo, second right. Gate is opposite the filling station.' }
});

const houses = [
	['Adeyemi Street', '14', 'Bello Musa', '08030000002'],
	['Adeyemi Street', '15', 'Ada Obi', '08030000003'],
	['Adeyemi Street', '16', '', ''],
	['Okafor Close', '2', 'Chidi Nwosu', '08030000004'],
	['Okafor Close', '4', 'Tolu Bankole', '08030000005']
];
const units = [];
for (const [street, number, name, phone] of houses) {
	const unit = await addUnit(estate.id, street, number);
	units.push(unit);
	if (phone) {
		const user = await upsertUser(phone.replace(/^0/, '+234'), name);
		const inv = await createInvite({ estateId: estate.id, unitId: unit.id, phone: user.phone, name, role: 'resident_primary', createdBy: admin.id });
		await acceptInvite(inv.code, user);
	}
}
await setDuesStatus(estate.id, admin.id, units[4].id, 'owing', 'Q3 service charge');

await addStaffAccount({ estateId: estate.id, actorUserId: admin.id, phone: '08030000010', name: 'Sunday Okon', role: 'guard', pin: '1234' });
await addStaffAccount({ estateId: estate.id, actorUserId: admin.id, phone: '08030000011', name: 'Ibrahim Yusuf', role: 'guard', pin: '5678' });

const [bello] = await db.select().from(schema.users).where(sql`phone = '+2348030000002'`);
const actor = { userId: bello.id, estateId: estate.id, unitId: units[0].id };
const guest = await createPass(actor, { type: 'guest', visitorName: 'Chidi Okafor', visitorPhone: '08051234567' });
const delivery = await createPass(actor, { type: 'delivery', visitorName: 'Chowdeck' });
await createPass(actor, { type: 'artisan', visitorName: 'Emeka Eze', purpose: 'Fix kitchen sink', validTo: new Date(Date.now() + 8 * 3_600_000) });
const { pass: driver } = await addStaffProfile(actor, { name: 'Musa Danjuma', role: 'Driver', phone: '08061234567', schedule: { days: [1, 2, 3, 4, 5, 6], start: '06:00', end: '20:00' } });
await createPass(actor, { type: 'event', visitorName: "Bello's 50th", maxEntries: 40, validFrom: new Date(Date.now() + 2 * 86_400_000), validTo: new Date(Date.now() + 2 * 86_400_000 + 9 * 3_600_000) });

// A gate phone with a code ready to enter at /gate, plus one already enrolled with history.
const fresh = await createDevice(estate.id, admin.id, gates[0].id, 'Main gate phone');
const histDev = await createDevice(estate.id, admin.id, gates[1].id, 'Back gate phone');
const enrolled = await enrollDevice(histDev.enrollCode!);
const device = await authDevice(`Bearer ${enrolled.token}`);
const h = (hoursAgo: number) => Date.now() - hoursAgo * 3_600_000;
await ingestEvents(device, [
	{ id: uuidv7(), kind: 'entry', method: 'code', passId: driver.id, visitorName: 'Musa Danjuma', guardName: 'Ibrahim Yusuf', deviceTs: h(30) },
	{ id: uuidv7(), kind: 'exit', method: 'manual', passId: driver.id, visitorName: 'Musa Danjuma', guardName: 'Ibrahim Yusuf', deviceTs: h(20) },
	{ id: uuidv7(), kind: 'entry', method: 'qr', passId: guest.id, visitorName: 'Chidi Okafor', guardName: 'Sunday Okon', deviceTs: h(2), offline: true },
	{ id: uuidv7(), kind: 'entry', method: 'code', passId: delivery.id, visitorName: 'Chowdeck', guardName: 'Sunday Okon', deviceTs: h(1) },
	{ id: uuidv7(), kind: 'exit', method: 'manual', passId: delivery.id, visitorName: 'Chowdeck', guardName: 'Sunday Okon', deviceTs: h(0.8) },
	{ id: uuidv7(), kind: 'override', method: 'override', visitorName: 'Inspector Bala', reason: 'Official / police', guardName: 'Sunday Okon', unitId: units[3].id, deviceTs: h(5) },
	{ id: uuidv7(), kind: 'deny', method: 'code', visitorName: '', reason: 'unknown_code', guardName: 'Sunday Okon', deviceTs: h(3) }
]);

console.log(`
Seeded "${estate.name}".

  Estate manager   0803 000 0001   → /admin
  Resident         0803 000 0002   → /app   (14 Adeyemi Street)
  Guards (on /gate) Sunday Okon PIN 1234 · Ibrahim Yusuf PIN 5678

  Gate phone setup code for Main gate: ${fresh.enrollCode}
  Guest pass code (Chidi Okafor): ${guest.code}

OTP codes show on the login screen in development, and every SMS is at /dev/outbox.
`);
process.exit(0);
