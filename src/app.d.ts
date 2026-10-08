import type { SessionContext } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			auth: SessionContext | null;
			sessionToken: string | null;
		}
		interface Error {
			message: string;
			code?: string;
		}
	}
}

export {};
