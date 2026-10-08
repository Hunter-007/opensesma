import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Netlify Database applies netlify/database/migrations/ on deploy; the dev
// database uses ./drizzle. They must contain the same SQL, and Netlify's
// naming rule (<number>_<slug>) must hold.
describe('migrations', () => {
	const drizzle = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort();
	const netlify = readdirSync('netlify/database/migrations').sort();

	it('every Drizzle migration is mirrored for Netlify, byte for byte', () => {
		expect(netlify).toEqual(drizzle);
		for (const f of drizzle) expect(readFileSync(`netlify/database/migrations/${f}`, 'utf8')).toBe(readFileSync(`drizzle/${f}`, 'utf8'));
	});

	it('names match Netlify’s <number>_<slug> rule', () => {
		for (const f of netlify) expect(f).toMatch(/^\d+_[a-z0-9_-]+\.sql$/);
	});
});
