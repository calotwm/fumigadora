ALTER TYPE "public"."notification_kind" ADD VALUE 'visit_postponed';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'visit_cancelled';--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "cancel_reason" text;