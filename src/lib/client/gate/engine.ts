import { v7 as uuidv7 } from 'uuid';
import { evaluatePass, localDayKey, matchesBan } from '$lib/shared/evaluate';
import { extractToken, verifyPass, type PassClaims } from '$lib/shared/passToken';
import { verifyPin } from '$lib/shared/pin';
import { DENY_MESSAGES, type EventKind, type EventMethod, type PassType } from '$lib/shared/types';
import type { SyncPayload } from '$lib/shared/sync';
import * as store from './store';
import type { DeviceConfig, EstateInfo, GuardSession, LocalEvent, LocalPass, SyncBan, SyncGuard, SyncMeta, SyncUnit } from './store';

/**
 * The guard console's brain. Pure logic + IndexedDB; the Svelte page only
 * renders state. Every decision here works with zero network.
 */

export interface CheckResult {
	allow: boolean;
	reason?: string;
	message: string;
	warnings: string[];
	claims: PassClaims | null;
	pass: LocalPass | null;
	unit: SyncUnit | null;
	method: EventMethod;
	/** The pass verified, but we haven't heard about cancellations for a while. */
	stale: boolean;
}

/** Wrong-code lockout: short after a burst, long after sustained guessing. */
const CODE_LOCKS = [
	{ failures: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
	{ failures: 5, windowMs: 60_000, lockMs: 60_000 }
];
/** Wrong-PIN lockout for starting a shift. */
const PIN_LOCK = { failures: 5, windowMs: 15 * 60_000, lockMs: 5 * 60_000 };

function lockRemaining(failures: number[], now: number, rules: { failures: number; windowMs: number; lockMs: number }[]): number {
	let remaining = 0;
	for (const r of rules) {
		const recent = failures.filter((t) => now - t < r.windowMs);
		if (recent.length >= r.failures) {
			const until = recent[recent.length - 1] + r.lockMs;
			remaining = Math.max(remaining, until - now);
		}
	}
	return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export class GateEngine {
	config: DeviceConfig | null = null;
	estate: EstateInfo | null = null;
	meta: SyncMeta = { cursor: null, lastSyncAt: null, unitsHash: '', guardsHash: '', bansHash: '' };
	units: SyncUnit[] = [];
	guards: SyncGuard[] = [];
	bans: SyncBan[] = [];
	guard: GuardSession | null = null;
	private codeFailures: number[] = [];
	private pinFailures: number[] = [];
	private syncing: Promise<SyncOutcome> | null = null;
	/**
	 * Server time anchored to a monotonic clock at the last sync. Changing the
	 * phone's date afterwards doesn't move it, so expired passes stay expired.
	 */
	private clockAnchor: { server: number; mono: number } | null = null;

	async load() {
		this.config = (await store.kv.get<DeviceConfig>('config')) ?? null;
		this.estate = (await store.kv.get<EstateInfo>('estate')) ?? null;
		this.meta = (await store.kv.get<SyncMeta>('meta')) ?? this.meta;
		this.units = (await store.kv.get<SyncUnit[]>('units')) ?? [];
		this.guards = (await store.kv.get<SyncGuard[]>('guards')) ?? [];
		this.bans = (await store.kv.get<SyncBan[]>('bans')) ?? [];
		this.guard = (await store.kv.get<GuardSession>('guard')) ?? null;
		this.codeFailures = (await store.kv.get<number[]>('codeFailures')) ?? [];
		this.pinFailures = (await store.kv.get<number[]>('pinFailures')) ?? [];
		return this;
	}

	get enrolled() {
		return !!this.config;
	}
	get ready() {
		return !!this.config && !!this.estate;
	}
	unit(id: string | null | undefined) {
		return this.units.find((u) => u.id === id) ?? null;
	}
	/** Best estimate of the real time: server-anchored when we have synced this session. */
	now(): number {
		if (this.clockAnchor) return this.clockAnchor.server + (performance.now() - this.clockAnchor.mono);
		return Date.now();
	}
	isStale(now = this.now()) {
		const hours = this.estate?.staleSyncHours ?? 6;
		return !this.meta.lastSyncAt || now - this.meta.lastSyncAt > hours * 3_600_000;
	}

	// ------------------------------------------------------------ enrolment & shifts

	async enroll(code: string) {
		const res = await fetch('/api/gate/enroll', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(body.error ?? 'Could not set up this phone. Check the code and your internet.');
		this.config = { token: body.token, deviceId: body.deviceId, estateId: body.estateId, gateId: body.gateId };
		await store.kv.set('config', this.config);
		const outcome = await this.sync();
		if (!outcome.ok) throw new Error('Set up, but the first download failed. Stay online and tap Sync.');
	}

	/** Seconds until another PIN may be tried (0 = not locked). */
	pinLockedFor(now = this.now()): number {
		return lockRemaining(this.pinFailures, now, [PIN_LOCK]);
	}

	async startShift(guardId: string, pin: string): Promise<boolean> {
		const now = this.now();
		if (this.pinLockedFor(now)) return false;
		const g = this.guards.find((x) => x.id === guardId);
		if (!g || !(await verifyPin(pin, g.pinHash))) {
			this.pinFailures = [...this.pinFailures.filter((t) => now - t < PIN_LOCK.windowMs), now];
			await store.kv.set('pinFailures', this.pinFailures);
			return false;
		}
		this.pinFailures = [];
		await store.kv.set('pinFailures', this.pinFailures);
		this.guard = { id: g.id, name: g.name, since: Date.now() };
		await store.kv.set('guard', this.guard);
		return true;
	}

	async endShift() {
		this.guard = null;
		await store.kv.del('guard');
	}

	// ------------------------------------------------------------ sync

	/** Upload queued events first, then pull changes, so counts the server sends already include ours. */
	sync(): Promise<SyncOutcome> {
		if (!this.syncing) this.syncing = this.exclusive(() => this.doSync()).finally(() => (this.syncing = null));
		return this.syncing;
	}

	/**
	 * The device token rotates during sync, so two tabs of the console must never
	 * sync at once (one would keep a replaced token and get the phone blocked).
	 */
	private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const locks = (globalThis.navigator as Navigator | undefined)?.locks;
		return locks ? locks.request('opensesma-gate-sync', fn) : fn();
	}

	private async authed(input: string, init: RequestInit = {}) {
		// Always use the newest token on disk: another tab may have rotated it.
		const saved = await store.kv.get<DeviceConfig>('config');
		if (saved) this.config = saved;
		if (!this.config) throw new Error('not_enrolled');
		return fetch(input, {
			...init,
			headers: { ...(init.headers ?? {}), authorization: `Bearer ${this.config!.token}` },
			signal: AbortSignal.timeout(15_000)
		});
	}

	private async doSync(): Promise<SyncOutcome> {
		if (!this.config) return { ok: false, error: 'not_enrolled' };
		try {
			// 1. Upload (with the phone's clock, so the server can spot a wrong date)
			for (let i = 0; i < 10; i++) {
				const pending = await store.pendingEvents(100);
				if (!pending.length) break;
				const res = await this.authed('/api/gate/events', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ events: pending, sentAt: Date.now() })
				});
				if (res.status === 401) return await this.removed();
				if (!res.ok) throw new Error(`upload ${res.status}`);
				const { accepted } = await res.json();
				await store.markUploaded(accepted);
				if (accepted.length < pending.length) break;
			}

			// 2. Download
			const q = new URLSearchParams();
			if (this.meta.cursor) q.set('since', this.meta.cursor);
			if (this.meta.unitsHash) q.set('u', this.meta.unitsHash);
			if (this.meta.guardsHash) q.set('g', this.meta.guardsHash);
			if (this.meta.bansHash) q.set('b', this.meta.bansHash);
			const sentAt = performance.now();
			const res = await this.authed(`/api/gate/sync?${q}`);
			if (res.status === 401) return await this.removed();
			if (!res.ok) throw new Error(`sync ${res.status}`);
			const data = (await res.json()) as SyncPayload;
			// Anchor to server time (half the round trip is a fair estimate of the delay).
			const mono = performance.now();
			this.clockAnchor = { server: data.serverTime + (mono - sentAt) / 2, mono };
			if (data.newToken) {
				this.config = { ...this.config, token: data.newToken };
				await store.kv.set('config', this.config);
			}
			await this.apply(data);
			return { ok: true, changed: data.passes.length };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : 'offline' };
		}
	}

	private async apply(d: SyncPayload) {
		this.estate = {
			...d.estate,
			gateName: d.gate.name,
			deviceName: d.device.name
		};
		await store.kv.set('estate', this.estate);
		await store.upsertPasses(d.passes);
		if (d.units) {
			this.units = d.units;
			await store.kv.set('units', d.units);
		}
		if (d.guards) {
			this.guards = d.guards;
			await store.kv.set('guards', d.guards);
			// A guard removed by the manager is signed out on the next sync.
			if (this.guard && !d.guards.some((g) => g.id === this.guard!.id)) await this.endShift();
		}
		if (d.bans) {
			this.bans = d.bans;
			await store.kv.set('bans', d.bans);
		}
		this.meta = { cursor: d.cursor, lastSyncAt: d.serverTime, unitsHash: d.unitsHash, guardsHash: d.guardsHash, bansHash: d.bansHash };
		await store.kv.set('meta', this.meta);
		await store.prunePasses();
		await store.pruneEvents();
	}

	private async removed(): Promise<SyncOutcome> {
		await store.resetDevice();
		this.config = null;
		this.estate = null;
		this.guard = null;
		return { ok: false, error: 'device_removed' };
	}

	// ------------------------------------------------------------ verification

	/** Called with whatever the camera read. */
	async checkScan(scanned: string, now = new Date(this.now())): Promise<CheckResult> {
		const token = extractToken(scanned);
		if (!token) return this.deny('bad_signature', 'qr', null, null, 'Not an OpenSesma pass');
		if (!this.estate) return this.deny('not_ready', 'qr', null, null, 'Phone not set up');
		const v = verifyPass(token, this.estate.publicKey);
		if (!v.ok) return this.deny('bad_signature', 'qr', null, null, DENY_MESSAGES.bad_signature);
		const local = (await store.getPass(v.claims.id)) ?? null;
		// Edited passes are re-issued; an older copy of the QR must stop working.
		const superseded = !!local && local.claims.iat > v.claims.iat;
		return this.decide(v.claims, local, 'qr', now, superseded);
	}

	/** Seconds until codes can be entered again (0 = not locked). */
	codeLockedFor(now = this.now()): number {
		return lockRemaining(this.codeFailures, now, CODE_LOCKS);
	}

	async checkCode(raw: string, now = new Date(this.now())): Promise<CheckResult> {
		const code = raw.replace(/\D/g, '');
		const locked = this.codeLockedFor(now.getTime());
		if (locked)
			return this.deny('locked', 'code', null, null, `Too many wrong codes. Code entry is paused for ${locked > 90 ? Math.ceil(locked / 60) + ' minutes' : locked + ' seconds'}. Use Walk-in meanwhile.`);
		// Codes recycle once a pass ends, so several local passes can share one.
		// Prefer an active pass; otherwise show the most recent cancelled one so
		// the guard sees "cancelled by the resident" rather than "not recognised".
		const all = await store.passesByCode(code);
		const byEnd = (a: LocalPass, b: LocalPass) => (b.validTo ?? Infinity) - (a.validTo ?? Infinity);
		const pass = all.filter((p) => p.status === 'active').sort(byEnd)[0] ?? all.filter((p) => p.status === 'revoked').sort(byEnd)[0];
		if (!pass) {
			this.codeFailures = [...this.codeFailures.filter((t) => now.getTime() - t < 15 * 60_000), now.getTime()];
			// Persisted so reloading the page doesn't reset the lockout.
			await store.kv.set('codeFailures', this.codeFailures);
			const msg = this.isStale(now.getTime())
				? 'Code not on this phone. The phone has not synced for a while — use Walk-in to ask the resident.'
				: DENY_MESSAGES.unknown_code;
			return this.deny('unknown_code', 'code', null, null, msg);
		}
		// The code was delivered by our own server, so its details are trusted as synced.
		return this.decide(pass.claims, pass, 'code', now, false);
	}

	private async decide(claims: PassClaims, local: LocalPass | null, method: EventMethod, now: Date, superseded: boolean): Promise<CheckResult> {
		if (!this.estate) return this.deny('not_ready', method, null, null, 'Phone not set up');
		const unit = this.unit(claims.unitId);
		const movement = await this.movement(claims.id, local, now);
		const decision = evaluatePass(claims, {
			now,
			estateId: this.estate.id,
			timeZone: this.estate.timeZone,
			entriesUsed: Math.max(local?.entriesUsed ?? 0, movement.entriesTotalLocal),
			entriesToday: movement.entriesToday,
			inside: movement.inside,
			revoked: local?.status === 'revoked' || superseded,
			banned: matchesBan({ name: claims.name }, this.bans),
			unitActive: unit ? unit.active : true,
			duesOwingWarning: this.estate.levyRule !== 'off' && unit?.dues === 'owing'
		});
		const stale = this.isStale(now.getTime());
		if (!decision.allow) return this.deny(decision.reason, method, claims, local, DENY_MESSAGES[decision.reason], unit);
		const warnings = [...decision.warnings];
		if (stale) warnings.push('Phone has not synced recently — cancellations may be missing');
		return { allow: true, message: 'Let in', warnings, claims, pass: local, unit, method, stale };
	}

	/**
	 * Entries today and in/out state for a pass, combining what the server last
	 * told us (all gates) with what happened at this gate since.
	 */
	private async movement(passId: string, local: LocalPass | null, now: Date) {
		const tz = this.estate?.timeZone ?? 'Africa/Lagos';
		const today = localDayKey(now, tz);
		const events = (await store.recentEvents(now.getTime() - 2 * 86_400_000)).filter((e) => e.passId === passId && e.kind !== 'deny');
		const localToday = events.filter((e) => e.kind !== 'exit' && localDayKey(new Date(e.deviceTs), tz) === today).length;
		const sinceSync = events.filter((e) => !this.meta.lastSyncAt || e.deviceTs > this.meta.lastSyncAt);
		const lastLocal = sinceSync.at(-1);
		const serverToday = local && this.meta.lastSyncAt && localDayKey(new Date(this.meta.lastSyncAt), tz) === today ? local.entriesToday : 0;
		const inside = lastLocal ? lastLocal.kind !== 'exit' : local?.lastMove === 'in';
		return {
			entriesToday: Math.max(serverToday, localToday),
			inside,
			entriesTotalLocal: events.filter((e) => e.kind !== 'exit').length
		};
	}

	private deny(reason: string, method: EventMethod, claims: PassClaims | null, pass: LocalPass | null, message: string, unit: SyncUnit | null = null): CheckResult {
		return { allow: false, reason, message, warnings: [], claims, pass, unit: unit ?? this.unit(claims?.unitId), method, stale: this.isStale() };
	}

	// ------------------------------------------------------------ recording

	async record(input: {
		kind: EventKind;
		method: EventMethod;
		passId?: string | null;
		unitId?: string | null;
		passType?: PassType | null;
		visitorName?: string;
		reason?: string;
	}): Promise<LocalEvent> {
		const e: LocalEvent = {
			id: uuidv7(),
			kind: input.kind,
			method: input.method,
			passId: input.passId ?? null,
			unitId: input.unitId ?? null,
			passType: input.passType ?? null,
			visitorName: input.visitorName ?? '',
			reason: input.reason ?? '',
			guardUserId: this.guard?.id ?? null,
			guardName: this.guard?.name ?? '',
			deviceTs: Math.round(this.now()),
			offline: !navigator.onLine,
			uploaded: false
		};
		await store.addEvent(e);
		if ((input.kind === 'entry' || input.kind === 'override') && input.passId) {
			const p = await store.getPass(input.passId);
			if (p) await store.bumpEntries(p);
		}
		return e;
	}

	/** Check in a verified pass. Also records the pass locally if it was created after the last sync. */
	async checkIn(result: CheckResult) {
		if (!result.claims) return;
		// The UI keeps results in reactive state (proxies), which IndexedDB can't
		// store. Work on a plain copy.
		const r = { ...result, claims: JSON.parse(JSON.stringify(result.claims)) as PassClaims };
		if (!result.pass) {
			await store.upsertPasses([
				{
					id: r.claims.id,
					code: '',
					claims: r.claims,
					unitId: r.claims.unitId,
					type: r.claims.type,
					name: r.claims.name,
					purpose: '',
					entriesUsed: 0,
					entriesToday: 0,
					lastMove: null,
					maxEntries: r.claims.maxEntries,
					status: 'active',
					validTo: r.claims.validTo ? r.claims.validTo * 1000 : null
				}
			]);
		}
		return this.record({ kind: 'entry', method: r.method, passId: r.claims.id, unitId: r.claims.unitId, passType: r.claims.type, visitorName: r.claims.name });
	}

	/** Who entered in the last 24 h and hasn't been checked out. */
	async insideNow() {
		const events = await store.recentEvents(this.now() - 86_400_000);
		const inside = new Map<string, LocalEvent>();
		for (const e of events) {
			const key = e.passId ?? `${e.unitId}:${e.visitorName.toLowerCase()}`;
			if (e.kind === 'entry' || e.kind === 'override') inside.set(key, e);
			else if (e.kind === 'exit') inside.delete(key);
		}
		return [...inside.values()].sort((a, b) => b.deviceTs - a.deviceTs);
	}

	async pendingCount() {
		return (await store.pendingEvents(1000)).length;
	}

	// ------------------------------------------------------------ walk-ins (need network)

	async requestWalkin(input: { unitId: string; visitorName: string; visitorPhone?: string; purpose?: string }) {
		const res = await this.authed('/api/gate/walkins', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...input, guardName: this.guard?.name })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(body.error ?? 'Could not reach the server');
		return body as { id: string; status: string; unitLabel: string };
	}

	async pollWalkin(id: string) {
		const res = await this.authed(`/api/gate/walkins/${id}`);
		if (!res.ok) throw new Error('poll failed');
		return (await res.json()) as {
			id: string;
			status: 'pending' | 'approved' | 'denied' | 'expired';
			decidedByName: string | null;
			note: string;
			smsSent: boolean;
			timedOut: boolean;
			callNumbers: string[];
			pass: { id: string; token: string; code: string } | null;
		};
	}
}

export type SyncOutcome = { ok: true; changed: number } | { ok: false; error: string };
