CREATE TABLE "guard_shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"estate_id" text NOT NULL,
	"guard_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"gate_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"started_offline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guard_shifts" ADD CONSTRAINT "guard_shifts_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shifts" ADD CONSTRAINT "guard_shifts_guard_user_id_users_id_fk" FOREIGN KEY ("guard_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shifts" ADD CONSTRAINT "guard_shifts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shifts" ADD CONSTRAINT "guard_shifts_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guard_shifts_one_open_per_guard" ON "guard_shifts" USING btree ("guard_user_id") WHERE "guard_shifts"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "guard_shifts_device_open" ON "guard_shifts" USING btree ("device_id","ended_at");