ALTER TYPE "public"."email_kind" ADD VALUE 'portal_login';--> statement-breakpoint
CREATE TABLE "client_login_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_login_tokens_hash_uq" ON "client_login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_login_tokens_expires_idx" ON "client_login_tokens" USING btree ("expires_at");