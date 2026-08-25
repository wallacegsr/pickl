ALTER TABLE `users` ADD `is_global_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `invite_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `invite_token_expires` integer;--> statement-breakpoint
-- Data backfill: on any pre-existing database, flag the earliest-created
-- admin user as the global admin, so the "exactly one global admin, fixed
-- at bootstrap" invariant holds after upgrading rather than leaving every
-- existing admin un-flagged. No-op (0 rows affected) on a fresh database
-- with no users yet.
UPDATE `users` SET `is_global_admin` = 1 WHERE `id` = (
	SELECT `id` FROM `users` WHERE `role` = 'admin' ORDER BY `created_at` ASC LIMIT 1
);