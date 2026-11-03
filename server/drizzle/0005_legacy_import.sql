CREATE TABLE "client_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"position" text,
	"notes" text,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "legacy_file_url" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "legacy_id" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "legacy_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "legacy_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "legacy_id" integer;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "legacy_id" integer;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_contacts_legacy_id_uq" ON "client_contacts" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_legacy_id_uq" ON "certificates" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_legacy_id_uq" ON "clients" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_legacy_id_uq" ON "invoices" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_legacy_id_uq" ON "payments" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_legacy_id_uq" ON "visits" USING btree ("legacy_id");