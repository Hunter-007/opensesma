import type { PassClaims } from './passToken';
import type { DuesStatus, LevyRule, PassType } from './types';

/**
 * Shapes exchanged between the server and the offline guard device.
 *
 * Security: a gate phone receives what it needs to *check* a code, never what
 * it would take to *impersonate* a visitor. Passes arrive as unsigned claims
 * (no signature, so a stolen cache can't be shown at another gate as a QR),
 * and no resident or visitor phone numbers are sent.
 */
export interface SyncPass {
	id: string;
	code: string;
	/** Pass details as signed, minus the signature. */
	claims: PassClaims;
	unitId: string;
	type: PassType;
	name: string;
	purpose: string;
	entriesUsed: number;
	/** Entries so far today (estate local day), across all gates. */
	entriesToday: number;
	/** Last movement seen through any gate, for "already inside" warnings. */
	lastMove: 'in' | 'out' | null;
	maxEntries: number;
	status: 'active' | 'revoked';
	validTo: number | null;
}
export interface SyncUnit {
	id: string;
	label: string;
	active: boolean;
	dues: DuesStatus;
}
export interface SyncGuard {
	id: string;
	name: string;
	pinHash: string;
}
export interface SyncBan {
	id: string;
	name: string | null;
	reason: string;
}
export interface SyncPayload {
	serverTime: number;
	cursor: string;
	/** A replacement device token; the device must store it and use it from now on. */
	newToken?: string;
	estate: { id: string; name: string; timeZone: string; publicKey: string; levyRule: LevyRule; staleSyncHours: number };
	gate: { id: string; name: string };
	device: { id: string; name: string };
	passes: SyncPass[];
	/** Sent only when changed (hash differs from what the device holds). */
	units?: SyncUnit[];
	unitsHash: string;
	guards?: SyncGuard[];
	guardsHash: string;
	bans?: SyncBan[];
	bansHash: string;
}
