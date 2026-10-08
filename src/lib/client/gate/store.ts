/**
 * Tiny IndexedDB wrapper for the guard console. Everything the gate needs to
 * work with no network lives here: the estate's public key, active passes,
 * houses, guards (with PIN hashes), the ban list, and the queue of events
 * waiting to upload.
 */
import type { SyncBan, SyncGuard, SyncPass, SyncUnit } from '$lib/shared/sync';
import type { EventKind, EventMethod, LevyRule, PassType } from '$lib/shared/types';

export type { SyncBan, SyncGuard, SyncPass, SyncUnit };

export interface DeviceConfig {
	token: string;
	deviceId: string;
	estateId: string;
	gateId: string;
}
export interface EstateInfo {
	id: string;
	name: string;
	timeZone: string;
	publicKey: string;
	levyRule: LevyRule;
	staleSyncHours: number;
	gateName: string;
	deviceName: string;
}
export interface SyncMeta {
	cursor: string | null;
	lastSyncAt: number | null;
	unitsHash: string;
	guardsHash: string;
	bansHash: string;
}
export interface GuardSession {
	id: string;
	name: string;
	since: number;
}
export interface LocalEvent {
	id: string;
	kind: EventKind;
	method: EventMethod;
	passId: string | null;
	unitId: string | null;
	passType: PassType | null;
	visitorName: string;
	reason: string;
	guardUserId: string | null;
	guardName: string;
	deviceTs: number;
	offline: boolean;
	uploaded: boolean;
}

const DB_NAME = 'opensesma-gate';
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (dbp) return dbp;
	dbp = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			db.createObjectStore('kv');
			const passes = db.createObjectStore('passes', { keyPath: 'id' });
			passes.createIndex('code', 'code');
			const events = db.createObjectStore('events', { keyPath: 'id' });
			events.createIndex('uploaded', 'uploadedFlag');
			events.createIndex('deviceTs', 'deviceTs');
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbp;
}

const done = <T>(req: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const t = db.transaction(store, mode);
		const s = t.objectStore(store);
		const r = fn(s);
		let result: T | undefined;
		if (r) r.onsuccess = () => (result = r.result);
		t.oncomplete = () => resolve(result);
		t.onerror = () => reject(t.error);
		t.onabort = () => reject(t.error);
	});
}

// ---------------------------------------------------------------- key/value

export const kv = {
	get: <T>(key: string) => tx<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>),
	set: (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key)),
	del: (key: string) => tx('kv', 'readwrite', (s) => s.delete(key))
};

// ---------------------------------------------------------------- passes

export type LocalPass = SyncPass;

export async function upsertPasses(passes: SyncPass[]) {
	if (!passes.length) return;
	const db = await open();
	await new Promise<void>((resolve, reject) => {
		const t = db.transaction('passes', 'readwrite');
		const s = t.objectStore('passes');
		for (const p of passes) {
			const get = s.get(p.id);
			get.onsuccess = () => {
				const existing = get.result as LocalPass | undefined;
				// Never lower a local entry count: our own un-uploaded check-ins count too.
				s.put({ ...p, entriesUsed: Math.max(p.entriesUsed, existing?.entriesUsed ?? 0) });
			};
		}
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
}

export const getPass = (id: string) => tx<LocalPass>('passes', 'readonly', (s) => s.get(id) as IDBRequest<LocalPass>);

export async function passesByCode(code: string): Promise<LocalPass[]> {
	const db = await open();
	return done(db.transaction('passes').objectStore('passes').index('code').getAll(code)) as Promise<LocalPass[]>;
}

export async function bumpEntries(pass: LocalPass) {
	await tx('passes', 'readwrite', (s) => s.put({ ...pass, entriesUsed: pass.entriesUsed + 1 }));
}

/** Drop passes that ended more than a day ago, or were revoked more than a week ago. */
export async function prunePasses() {
	const db = await open();
	const all = (await done(db.transaction('passes').objectStore('passes').getAll())) as LocalPass[];
	const cutoff = Date.now() - 86_400_000;
	const stale = all.filter((p) => (p.validTo && p.validTo < cutoff) || (p.status === 'revoked' && p.validTo && p.validTo < Date.now()));
	if (stale.length) await tx('passes', 'readwrite', (s) => void stale.forEach((p) => s.delete(p.id)));
	return all.length - stale.length;
}

export async function countPasses(): Promise<number> {
	const db = await open();
	return done(db.transaction('passes').objectStore('passes').count());
}

// ---------------------------------------------------------------- events

export async function addEvent(e: LocalEvent) {
	await tx('events', 'readwrite', (s) => s.put({ ...e, uploadedFlag: e.uploaded ? 1 : 0 }));
}

export async function pendingEvents(limit = 200): Promise<LocalEvent[]> {
	const db = await open();
	return done(db.transaction('events').objectStore('events').index('uploaded').getAll(0, limit)) as Promise<LocalEvent[]>;
}

export async function markUploaded(ids: string[]) {
	if (!ids.length) return;
	const db = await open();
	await new Promise<void>((resolve, reject) => {
		const t = db.transaction('events', 'readwrite');
		const s = t.objectStore('events');
		for (const id of ids) {
			const g = s.get(id);
			g.onsuccess = () => g.result && s.put({ ...g.result, uploaded: true, uploadedFlag: 1 });
		}
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
}

export async function recentEvents(sinceMs: number): Promise<LocalEvent[]> {
	const db = await open();
	const rows = (await done(db.transaction('events').objectStore('events').index('deviceTs').getAll(IDBKeyRange.lowerBound(sinceMs)))) as LocalEvent[];
	return rows.sort((a, b) => a.deviceTs - b.deviceTs);
}

/** Keep the local log small: uploaded events older than 3 days go. */
export async function pruneEvents() {
	const db = await open();
	const old = (await done(db.transaction('events').objectStore('events').index('deviceTs').getAll(IDBKeyRange.upperBound(Date.now() - 3 * 86_400_000)))) as LocalEvent[];
	const del = old.filter((e) => e.uploaded);
	if (del.length) await tx('events', 'readwrite', (s) => void del.forEach((e) => s.delete(e.id)));
}

/** Wipe everything (device removed by the estate manager). */
export async function resetDevice() {
	const db = await open();
	await new Promise<void>((resolve, reject) => {
		const t = db.transaction(['kv', 'passes', 'events'], 'readwrite');
		t.objectStore('kv').clear();
		t.objectStore('passes').clear();
		t.objectStore('events').clear();
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
}
