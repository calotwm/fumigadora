ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assignable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
UPDATE "users" SET "assignable" = false WHERE "role" = 'admin';
