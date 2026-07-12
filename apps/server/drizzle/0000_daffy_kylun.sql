CREATE TABLE "subject" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"icon" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_state_ck" CHECK ("card"."state" in (0,1,2,3))
);
--> statement-breakpoint
CREATE TABLE "review_log" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"rating" integer NOT NULL,
	"state" integer NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"elapsed_days" integer NOT NULL,
	"last_elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"learning_steps" integer NOT NULL,
	"review" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_log_rating_ck" CHECK ("review_log"."rating" between 0 and 4),
	CONSTRAINT "review_log_state_ck" CHECK ("review_log"."state" in (0,1,2,3))
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"original_filename" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "note_source_type_ck" CHECK ("note"."source_type" in ('md','pdf'))
);
--> statement-breakpoint
CREATE TABLE "generation" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"deck_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text NOT NULL,
	"items" jsonb NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "generation_kind_ck" CHECK ("generation"."kind" in ('cards','quiz')),
	CONSTRAINT "generation_status_ck" CHECK ("generation"."status" in ('pending','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "exam" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_subject" (
	"exam_id" text NOT NULL,
	"subject_id" text NOT NULL,
	CONSTRAINT "exam_subject_exam_id_subject_id_pk" PRIMARY KEY("exam_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "deck" ADD CONSTRAINT "deck_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject" ADD CONSTRAINT "exam_subject_exam_id_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject" ADD CONSTRAINT "exam_subject_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subject_archived_idx" ON "subject" USING btree ("archived");--> statement-breakpoint
CREATE INDEX "subject_position_idx" ON "subject" USING btree ("position");--> statement-breakpoint
CREATE INDEX "deck_subject_idx" ON "deck" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "card_deck_idx" ON "card" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "card_due_idx" ON "card" USING btree ("due");--> statement-breakpoint
CREATE INDEX "card_deck_due_idx" ON "card" USING btree ("deck_id","due");--> statement-breakpoint
CREATE INDEX "card_state_idx" ON "card" USING btree ("state");--> statement-breakpoint
CREATE INDEX "review_log_card_idx" ON "review_log" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "review_log_review_idx" ON "review_log" USING btree ("review");--> statement-breakpoint
CREATE INDEX "review_log_card_review_idx" ON "review_log" USING btree ("card_id","review");--> statement-breakpoint
CREATE INDEX "note_subject_idx" ON "note" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "generation_note_idx" ON "generation" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "generation_deck_idx" ON "generation" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "exam_date_idx" ON "exam" USING btree ("date");--> statement-breakpoint
CREATE INDEX "exam_subject_subject_idx" ON "exam_subject" USING btree ("subject_id");