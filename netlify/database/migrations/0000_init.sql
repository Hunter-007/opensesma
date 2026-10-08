CREATE TABLE "access_events" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"gate_id" text NOT NULL,
	"device_id" text NOT NULL,
	"guard_user_id" text,
	"guard_name" text DEFAULT '' NOT NULL,
	"pass_id" text,
	"unit_id" text,
	"pass_type" text,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"visitor_name" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"offline" boolean DEFAULT false NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"device_ts" timestamp with time zone NOT NULL,
	"server_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"estate_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"name" text,
	"phone" text,
	"reason" text NOT NULL,
	"added_by" text,
	"expires_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"gate_id" text NOT NULL,
	"name" text NOT NULL,
	"enroll_code" text,
	"enroll_expires_at" timestamp with time zone,
	"token_hash" text,
	"enrolled_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_enroll_code_unique" UNIQUE("enroll_code"),
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "estates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"settings" jsonb NOT NULL,
	"signing_public_key" text NOT NULL,
	"signing_secret_key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"unit_id" text,
	"code" text NOT NULL,
	"phone" text,
	"name" text DEFAULT '' NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"estate_id" text NOT NULL,
	"unit_id" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proof_note" text DEFAULT '' NOT NULL,
	"pin_hash" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"created_by" text NOT NULL,
	"type" text NOT NULL,
	"visitor_name" text DEFAULT '' NOT NULL,
	"visitor_phone" text,
	"purpose" text DEFAULT '' NOT NULL,
	"code" text NOT NULL,
	"token" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"schedule" jsonb,
	"max_entries" integer DEFAULT 1 NOT NULL,
	"entries_used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"staff_profile_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"active_estate_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"id_type" text DEFAULT '' NOT NULL,
	"id_number" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"street" text NOT NULL,
	"number" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"dues_status" text DEFAULT 'unknown' NOT NULL,
	"dues_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "walkin_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"gate_id" text NOT NULL,
	"device_id" text NOT NULL,
	"guard_name" text DEFAULT '' NOT NULL,
	"visitor_name" text NOT NULL,
	"visitor_phone" text,
	"purpose" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reply_token" text NOT NULL,
	"decided_by" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"sms_fallback_at" timestamp with time zone,
	"pass_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walkin_requests_reply_token_unique" UNIQUE("reply_token")
);
--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_staff_profile_id_staff_profiles_id_fk" FOREIGN KEY ("staff_profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkin_requests" ADD CONSTRAINT "walkin_requests_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkin_requests" ADD CONSTRAINT "walkin_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_estate_time" ON "access_events" USING btree ("estate_id","device_ts");--> statement-breakpoint
CREATE INDEX "events_pass" ON "access_events" USING btree ("pass_id");--> statement-breakpoint
CREATE INDEX "events_unit" ON "access_events" USING btree ("unit_id","device_ts");--> statement-breakpoint
CREATE INDEX "audit_estate_time" ON "audit_logs" USING btree ("estate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_estate" ON "memberships" USING btree ("user_id","estate_id");--> statement-breakpoint
CREATE INDEX "memberships_estate_status" ON "memberships" USING btree ("estate_id","status");--> statement-breakpoint
CREATE INDEX "otps_phone_created" ON "otps" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passes_active_code" ON "passes" USING btree ("estate_id","code") WHERE "passes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "passes_estate_updated" ON "passes" USING btree ("estate_id","updated_at");--> statement-breakpoint
CREATE INDEX "passes_unit" ON "passes" USING btree ("unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "units_estate_street_number" ON "units" USING btree ("estate_id","street","number");--> statement-breakpoint
CREATE INDEX "walkins_unit_status" ON "walkin_requests" USING btree ("unit_id","status");