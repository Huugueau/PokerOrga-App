CREATE TABLE "player_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"pseudo" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"qr_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "player_accounts_qr_code_unique" UNIQUE("qr_code")
);
--> statement-breakpoint
ALTER TABLE "club_members" ADD COLUMN "player_account_id" uuid;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "player_account_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "player_account_id" uuid;