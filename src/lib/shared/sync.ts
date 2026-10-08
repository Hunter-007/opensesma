import type { DuesStatus, LevyRule, PassType } from './types';

/** Shapes exchanged between the server and the offline guard device. */
export interface SyncPass {
	id: string;
	code: string;
	token: string;
	unitId: string;
	type: PassType;
	name: string;
	purpose: string;
	entriesUsed: number;
	maxEntries: number;
	status: 'active' | 'revoked';
	validTo: number | null;
	visitorPhone: string | null;
}
export interface SyncUnit {
	id: string;
	label: string;
	active: boolean;
	dues: DuesStatus;
	phone: string | null;
}
export interface SyncGuard {
	id: string;
	name: string;
	pinHash: string;
}
export interface SyncBan {
	id: string;
	name: string | null;
	phone: string | null;
	reason: string;
}
export interface SyncPayload {
	serverTime: number;
	cursor: string;
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
