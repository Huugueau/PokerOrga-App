CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "championship_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"points" numeric(8, 1) NOT NULL,
	"justification" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "championship_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_id" uuid NOT NULL,
	"tournament_id" uuid,
	"tournament_name" text NOT NULL,
	"entries" integer NOT NULL,
	"played_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "championship_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "championship_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"points" numeric(8, 1) NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "championships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'mtt' NOT NULL,
	"best_results" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"public_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "championships_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'classic' NOT NULL,
	"event_date" date,
	"event_time" text,
	"location" text,
	"capacity" integer,
	"max_per_table" integer DEFAULT 10 NOT NULL,
	"start_stack" integer DEFAULT 10000 NOT NULL,
	"financial_mode" text DEFAULT 'money' NOT NULL,
	"buyin" numeric(12, 2) DEFAULT 0 NOT NULL,
	"description" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_token" text NOT NULL,
	"tournament_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "favorite_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"levels" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"pseudo" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"table_number" integer,
	"seat_number" integer,
	"seat_locked" boolean DEFAULT false NOT NULL,
	"entries" integer DEFAULT 1 NOT NULL,
	"rebuys" integer DEFAULT 0 NOT NULL,
	"addons" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"bounty_value" numeric(12, 2) DEFAULT 0 NOT NULL,
	"bounty_won" numeric(12, 2) DEFAULT 0 NOT NULL,
	"eliminated_by" uuid,
	"eliminated_at" timestamp with time zone,
	"finish_rank" integer,
	"prize_amount" numeric(12, 2),
	"prize_label" text,
	"present" boolean DEFAULT false NOT NULL,
	"registration_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"pseudo" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"present" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"settings" jsonb NOT NULL,
	"structure" jsonb NOT NULL,
	"payouts" jsonb NOT NULL,
	"theme" jsonb NOT NULL,
	"clock" jsonb NOT NULL,
	"mystery" jsonb NOT NULL,
	"pending_moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_token" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"exported_championship_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"pseudo" text,
	"club_name" text,
	"usage_mode" text DEFAULT 'private' NOT NULL,
	"rake_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_bonuses" ADD CONSTRAINT "championship_bonuses_championship_id_championships_id_fk" FOREIGN KEY ("championship_id") REFERENCES "public"."championships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_bonuses" ADD CONSTRAINT "championship_bonuses_player_id_championship_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."championship_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_imports" ADD CONSTRAINT "championship_imports_championship_id_championships_id_fk" FOREIGN KEY ("championship_id") REFERENCES "public"."championships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_players" ADD CONSTRAINT "championship_players_championship_id_championships_id_fk" FOREIGN KEY ("championship_id") REFERENCES "public"."championships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_results" ADD CONSTRAINT "championship_results_import_id_championship_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."championship_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_results" ADD CONSTRAINT "championship_results_player_id_championship_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."championship_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championships" ADD CONSTRAINT "championships_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_configs" ADD CONSTRAINT "favorite_configs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_structures" ADD CONSTRAINT "favorite_structures_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_actions" ADD CONSTRAINT "player_actions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "champ_players_name_uq" ON "championship_players" USING btree ("championship_id",lower("name"));--> statement-breakpoint
CREATE INDEX "actions_tournament_idx" ON "player_actions" USING btree ("tournament_id","player_id");--> statement-breakpoint
CREATE INDEX "players_tournament_idx" ON "players" USING btree ("tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_tournament_pseudo_uq" ON "players" USING btree ("tournament_id",lower("pseudo"));--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_pseudo_uq" ON "registrations" USING btree ("event_id",lower("pseudo"));--> statement-breakpoint
CREATE UNIQUE INDEX "tables_tournament_number_uq" ON "tournament_tables" USING btree ("tournament_id","number");--> statement-breakpoint
CREATE INDEX "tournaments_owner_idx" ON "tournaments" USING btree ("owner_id","status");