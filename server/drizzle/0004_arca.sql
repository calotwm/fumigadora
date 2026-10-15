CREATE TYPE "public"."arca_status" AS ENUM('not_sent', 'authorized', 'rejected', 'error');--> statement-breakpoint
CREATE TYPE "public"."iva_condition" AS ENUM('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_categorizado');--> statement-breakpoint
CREATE TYPE "public"."tax_doc_type" AS ENUM('cuit', 'dni', 'none');--> statement-breakpoint
CREATE TABLE "arca_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"env" text NOT NULL,
	"service" text NOT NULL,
	"token" text NOT NULL,
	"sign" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_doc_type" "tax_doc_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_doc_number" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "iva_condition" "iva_condition" DEFAULT 'consumidor_final' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "arca_status" "arca_status" DEFAULT 'not_sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cbte_type" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pto_vta" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cbte_number" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cae" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cae_due_on" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "arca_observations" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "arca_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "arca_attempted_number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "arca_tokens_env_service_uq" ON "arca_tokens" USING btree ("env","service");