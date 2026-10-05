CREATE TYPE "public"."cash_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."client_kind" AS ENUM('business', 'home', 'building');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('none', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'transfer', 'mercadopago', 'check', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('scheduled', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "cash_kind" NOT NULL,
	"date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"category_id" integer,
	"description" text DEFAULT '' NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"visit_id" integer,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "client_kind" DEFAULT 'business' NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"area" text,
	"notes" text,
	"tax_id" text,
	"monthly_fee_cents" bigint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"visit_id" integer,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"period_month" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"paid_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_price_cents" bigint DEFAULT 0 NOT NULL,
	"issues_certificate" boolean DEFAULT false NOT NULL,
	"certificate_validity_days" integer
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"service_type_id" integer NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"status" "visit_status" DEFAULT 'scheduled' NOT NULL,
	"frequency" "frequency" DEFAULT 'none' NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone,
	"price_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_payment_idx" ON "allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "allocations_invoice_idx" ON "allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "cash_entries_date_idx" ON "cash_entries" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_number_uq" ON "certificates" USING btree ("number");--> statement-breakpoint
CREATE INDEX "certificates_client_idx" ON "certificates" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "certificates_expires_idx" ON "certificates" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "clients_name_idx" ON "clients" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "invoices_period_idx" ON "invoices" USING btree ("period_month");--> statement-breakpoint
CREATE INDEX "payments_client_idx" ON "payments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "payments_paid_on_idx" ON "payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "visits_date_idx" ON "visits" USING btree ("date");--> statement-breakpoint
CREATE INDEX "visits_client_idx" ON "visits" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "visits_status_date_idx" ON "visits" USING btree ("status","date");