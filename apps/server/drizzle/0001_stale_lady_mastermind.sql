CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credential" (
	"provider" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_credential_provider_ck" CHECK ("ai_credential"."provider" in ('anthropic','openrouter','openai-compat'))
);
--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_provider_ck" CHECK ("generation"."provider" is null or "generation"."provider" in ('anthropic','openrouter','ollama','openai-compat'));