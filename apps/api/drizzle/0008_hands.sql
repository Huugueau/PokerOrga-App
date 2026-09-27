CREATE TABLE "hands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"table_number" integer NOT NULL,
	"hand_number" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"config" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"deltas" jsonb,
	"level_index" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "chips" integer;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hands_table_idx" ON "hands" USING btree ("tournament_id","table_number","hand_number");