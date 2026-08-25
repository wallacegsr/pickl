CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`credentials_encrypted` text,
	`calendar_id` text DEFAULT '' NOT NULL,
	`display_name` text,
	`include_detail` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` integer,
	`last_sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by_user_id` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_connections_scope_user_id_unique` ON `calendar_connections` (`scope`,`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`date` text NOT NULL,
	`meal_type` text NOT NULL,
	`external_event_id` text NOT NULL,
	`last_pushed_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_connection_id_date_meal_type_unique` ON `calendar_event_links` (`connection_id`,`date`,`meal_type`);