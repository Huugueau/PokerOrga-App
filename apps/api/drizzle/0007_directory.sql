ALTER TABLE "clubs" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_accounts" ADD COLUMN "discoverable" boolean DEFAULT true NOT NULL;