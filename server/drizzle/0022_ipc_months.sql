CREATE TABLE "ipc_months" (
	"month" text PRIMARY KEY NOT NULL,
	"percent_bp" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
