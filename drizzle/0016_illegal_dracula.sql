PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_calendar_event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`plan_entry_id` text,
	`date` text NOT NULL,
	`meal_type` text NOT NULL,
	`external_event_id` text NOT NULL,
	`etag` text,
	`last_pushed_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `calendar_targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_entry_id`) REFERENCES `plan_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_calendar_event_links`("id", "target_id", "plan_entry_id", "date", "meal_type", "external_event_id", "etag", "last_pushed_at") SELECT "id", "target_id", "plan_entry_id", "date", "meal_type", "external_event_id", "etag", "last_pushed_at" FROM `calendar_event_links`;--> statement-breakpoint
DROP TABLE `calendar_event_links`;--> statement-breakpoint
ALTER TABLE `__new_calendar_event_links` RENAME TO `calendar_event_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_target_id_plan_entry_id_unique` ON `calendar_event_links` (`target_id`,`plan_entry_id`);