ALTER TABLE "clients" ADD COLUMN "service_frequency" "frequency" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "default_service_type_id" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_default_service_type_id_service_types_id_fk" FOREIGN KEY ("default_service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One-off backfill: derive each client's plan from its latest non-cancelled visit that has a frequency.
UPDATE "clients" SET "service_frequency" = latest."frequency", "default_service_type_id" = latest."service_type_id" FROM (SELECT DISTINCT ON ("client_id") "client_id", "frequency", "service_type_id" FROM "visits" WHERE "status" <> 'cancelled' AND "frequency" <> 'none' ORDER BY "client_id", "date" DESC, "id" DESC) AS latest WHERE "clients"."id" = latest."client_id";
