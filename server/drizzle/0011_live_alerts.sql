ALTER TYPE "public"."notification_kind" ADD VALUE 'visit_done';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'cash_collected';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_amount_cents" bigint;