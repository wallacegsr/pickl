PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`meal_type` text DEFAULT 'dinner' NOT NULL,
	`recipe_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- `position` is deliberately absent from both lists: drizzle-kit emitted it on
-- each side, but the old table has no such column, so the SELECT failed with
-- "no such column: position". Omitting it lets the DEFAULT 0 apply, which is
-- the correct value for every existing row — each slot holds exactly one
-- recipe today, so they are all first in their slot.
INSERT INTO `__new_plan_entries`("id", "date", "scope", "user_id", "meal_type", "recipe_id", "created_by_user_id", "created_at", "updated_at") SELECT "id", "date", "scope", "user_id", "meal_type", "recipe_id", "created_by_user_id", "created_at", "updated_at" FROM `plan_entries`;--> statement-breakpoint
DROP TABLE `plan_entries`;--> statement-breakpoint
ALTER TABLE `__new_plan_entries` RENAME TO `plan_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `plan_entries_date_scope_user_id_meal_type_recipe_id_unique` ON `plan_entries` (`date`,`scope`,`user_id`,`meal_type`,`recipe_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `calendar_event_links_target_id_date_meal_type_unique`;--> statement-breakpoint
ALTER TABLE `calendar_event_links` ADD `plan_entry_id` text REFERENCES plan_entries(id);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_target_id_plan_entry_id_unique` ON `calendar_event_links` (`target_id`,`plan_entry_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `shopping_list_status_scope_user_id_date_meal_type_ingredient_text_unique`;--> statement-breakpoint
ALTER TABLE `shopping_list_status` ADD `recipe_id` text REFERENCES recipes(id);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_status_scope_user_id_date_meal_type_recipe_id_ingredient_text_unique` ON `shopping_list_status` (`scope`,`user_id`,`date`,`meal_type`,`recipe_id`,`ingredient_text`);