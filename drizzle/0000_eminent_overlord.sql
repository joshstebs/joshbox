CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `characters_user` ON `characters` (`user_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`negative` text NOT NULL,
	`mode` text NOT NULL,
	`aspect` text NOT NULL,
	`seed` integer NOT NULL,
	`status` text NOT NULL,
	`remote_id` text,
	`message` text,
	`media` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_user` ON `jobs` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_job_per_user` ON `jobs` (`user_id`) WHERE "jobs"."status" in ('submitting','queued','running','archiving','uncertain');