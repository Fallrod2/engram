CREATE TABLE `subject` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subject_archived_idx` ON `subject` (`archived`);--> statement-breakpoint
CREATE INDEX `subject_position_idx` ON `subject` (`position`);--> statement-breakpoint
CREATE TABLE `deck` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subject`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_subject_idx` ON `deck` (`subject_id`);--> statement-breakpoint
CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_state_ck" CHECK("card"."state" in (0,1,2,3))
);
--> statement-breakpoint
CREATE INDEX `card_deck_idx` ON `card` (`deck_id`);--> statement-breakpoint
CREATE INDEX `card_due_idx` ON `card` (`due`);--> statement-breakpoint
CREATE INDEX `card_deck_due_idx` ON `card` (`deck_id`,`due`);--> statement-breakpoint
CREATE INDEX `card_state_idx` ON `card` (`state`);--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`rating` integer NOT NULL,
	`state` integer NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`last_elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`review` integer NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_log_rating_ck" CHECK("review_log"."rating" between 0 and 4),
	CONSTRAINT "review_log_state_ck" CHECK("review_log"."state" in (0,1,2,3))
);
--> statement-breakpoint
CREATE INDEX `review_log_card_idx` ON `review_log` (`card_id`);--> statement-breakpoint
CREATE INDEX `review_log_review_idx` ON `review_log` (`review`);--> statement-breakpoint
CREATE INDEX `review_log_card_review_idx` ON `review_log` (`card_id`,`review`);--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`original_filename` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subject`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "note_source_type_ck" CHECK("note"."source_type" in ('md','pdf'))
);
--> statement-breakpoint
CREATE INDEX `note_subject_idx` ON `note` (`subject_id`);--> statement-breakpoint
CREATE TABLE `generation` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`deck_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model` text NOT NULL,
	`items` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "generation_kind_ck" CHECK("generation"."kind" in ('cards','quiz')),
	CONSTRAINT "generation_status_ck" CHECK("generation"."status" in ('pending','succeeded','failed'))
);
--> statement-breakpoint
CREATE INDEX `generation_note_idx` ON `generation` (`note_id`);--> statement-breakpoint
CREATE INDEX `generation_deck_idx` ON `generation` (`deck_id`);--> statement-breakpoint
CREATE TABLE `exam` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` integer NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exam_date_idx` ON `exam` (`date`);--> statement-breakpoint
CREATE TABLE `exam_subject` (
	`exam_id` text NOT NULL,
	`subject_id` text NOT NULL,
	PRIMARY KEY(`exam_id`, `subject_id`),
	FOREIGN KEY (`exam_id`) REFERENCES `exam`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subject`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exam_subject_subject_idx` ON `exam_subject` (`subject_id`);