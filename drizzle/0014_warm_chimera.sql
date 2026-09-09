CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `tags_name_key_unique`;--> statement-breakpoint
ALTER TABLE `tags` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_household_id_name_key_unique` ON `tags` (`household_id`,`name_key`);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
ALTER TABLE `plan_entries` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
ALTER TABLE `recipes` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
ALTER TABLE `shopping_list_status` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
ALTER TABLE `users` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
-- Backfill. drizzle-kit adds the columns but cannot know what to put in them,
-- and left NULL every existing row would be orphaned from any household — an
-- existing single-family deployment would come back up showing nothing at all.
--
-- One household is created and everything already in the database is assigned
-- to it, including the global admin, who is a real member of that family as
-- well as the operator. Multi-tenancy therefore changes nothing for a
-- self-hosted install: it is simply a deployment with one household.
INSERT INTO `households` (`id`, `name`, `suspended`, `created_at`, `updated_at`)
SELECT 'household-default', 'Household', 0, strftime('%s','now'), strftime('%s','now')
WHERE NOT EXISTS (SELECT 1 FROM `households`);
--> statement-breakpoint
UPDATE `users` SET `household_id` = 'household-default' WHERE `household_id` IS NULL;--> statement-breakpoint
UPDATE `recipes` SET `household_id` = 'household-default' WHERE `household_id` IS NULL;--> statement-breakpoint
UPDATE `tags` SET `household_id` = 'household-default' WHERE `household_id` IS NULL;--> statement-breakpoint
UPDATE `plan_entries` SET `household_id` = 'household-default' WHERE `household_id` IS NULL;--> statement-breakpoint
UPDATE `shopping_list_status` SET `household_id` = 'household-default' WHERE `household_id` IS NULL;--> statement-breakpoint
UPDATE `audit_log` SET `household_id` = 'household-default' WHERE `household_id` IS NULL;
