CREATE TABLE "flight_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"label" text NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"target_day_id" uuid,
	"tournament_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_qualifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"from_day_id" uuid NOT NULL,
	"to_day_id" uuid NOT NULL,
	"pseudo" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"member_id" uuid,
	"stack" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qualify_pct" integer DEFAULT 15 NOT NULL,
	"day1_stack" integer DEFAULT 20000 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "start_chips" integer;--> statement-breakpoint
ALTER TABLE "flight_days" ADD CONSTRAINT "flight_days_series_id_flight_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."flight_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_qualifiers" ADD CONSTRAINT "flight_qualifiers_series_id_flight_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."flight_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_series" ADD CONSTRAINT "flight_series_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;