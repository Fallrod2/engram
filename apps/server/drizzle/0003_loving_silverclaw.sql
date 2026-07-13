ALTER TABLE "generation" DROP CONSTRAINT "generation_provider_ck";--> statement-breakpoint
ALTER TABLE "ai_credential" DROP CONSTRAINT "ai_credential_provider_ck";--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_provider_ck" CHECK ("generation"."provider" is null or "generation"."provider" in ('anthropic','openrouter','ollama','openai-compat','mistral'));--> statement-breakpoint
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_provider_ck" CHECK ("ai_credential"."provider" in ('anthropic','openrouter','openai-compat','mistral'));