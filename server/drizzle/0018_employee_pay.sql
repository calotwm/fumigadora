CREATE TYPE "public"."employee_pay_kind" AS ENUM('sueldo', 'adelanto', 'otro');--> statement-breakpoint
ALTER TABLE "cash_entries" ADD COLUMN "employee_id" integer;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD COLUMN "pay_kind" "employee_pay_kind";--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_entries_employee_idx" ON "cash_entries" USING btree ("employee_id","date");