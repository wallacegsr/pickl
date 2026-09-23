CREATE INDEX `audit_log_household_time_idx` ON `audit_log` (`household_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `calendar_event_links_plan_entry_idx` ON `calendar_event_links` (`plan_entry_id`);--> statement-breakpoint
CREATE INDEX `plan_entries_household_date_idx` ON `plan_entries` (`household_id`,`date`);--> statement-breakpoint
CREATE INDEX `plan_entries_recipe_date_idx` ON `plan_entries` (`recipe_id`,`date`);--> statement-breakpoint
CREATE INDEX `recipe_favorites_recipe_idx` ON `recipe_favorites` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_tags_tag_idx` ON `recipe_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `recipes_household_visibility_idx` ON `recipes` (`household_id`,`visibility`);--> statement-breakpoint
CREATE INDEX `recipes_owner_idx` ON `recipes` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `users_household_idx` ON `users` (`household_id`);