ALTER TABLE "access_events" ADD COLUMN "flag" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "prev_token_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "prev_token_valid_until" timestamp with time zone;