ALTER TABLE "note" DROP CONSTRAINT "note_source_type_ck";--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_source_type_ck" CHECK ("note"."source_type" in ('md','pdf','image'));