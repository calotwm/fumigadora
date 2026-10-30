CREATE TABLE "price_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"percent_basis_points" integer NOT NULL,
	"rounding" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"item_count" integer NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;