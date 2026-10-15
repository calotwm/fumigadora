CREATE TYPE "public"."email_kind" AS ENUM('service_notice', 'debt_reminder', 'test');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('sent', 'simulated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."route_plan_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "email_kind" NOT NULL,
	"client_id" integer,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"status" "email_status" NOT NULL,
	"error" text,
	"provider_id" text,
	"ref_type" text,
	"ref_id" text,
	"sent_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"run_date" date NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"service_type_id" integer NOT NULL,
	"assigned_user_id" integer,
	"zone" text,
	"visit_id" integer,
	"notice_due_on" date,
	"notice_email_log_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"status" "route_plan_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plan_items" ADD CONSTRAINT "route_plan_items_plan_id_route_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."route_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plan_items" ADD CONSTRAINT "route_plan_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plan_items" ADD CONSTRAINT "route_plan_items_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plan_items" ADD CONSTRAINT "route_plan_items_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plan_items" ADD CONSTRAINT "route_plan_items_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plan_items" ADD CONSTRAINT "route_plan_items_notice_email_log_id_email_log_id_fk" FOREIGN KEY ("notice_email_log_id") REFERENCES "public"."email_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_client_idx" ON "email_log" USING btree ("client_id","kind");--> statement-breakpoint
CREATE INDEX "email_log_created_idx" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_job_date_uq" ON "job_runs" USING btree ("job","run_date");--> statement-breakpoint
CREATE INDEX "route_plan_items_plan_idx" ON "route_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "route_plan_items_notice_idx" ON "route_plan_items" USING btree ("notice_due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "route_plans_month_uq" ON "route_plans" USING btree ("month");