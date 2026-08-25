CREATE TABLE `calendar_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`refresh_token_encrypted` text,
	`account_email` text,
	`scopes` text DEFAULT '' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_accounts_user_id_provider_unique` ON `calendar_accounts` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `calendar_event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`date` text NOT NULL,
	`meal_type` text NOT NULL,
	`external_event_id` text NOT NULL,
	`last_pushed_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `calendar_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_target_id_date_meal_type_unique` ON `calendar_event_links` (`target_id`,`date`,`meal_type`);--> statement-breakpoint
CREATE TABLE `calendar_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`calendar_id` text NOT NULL,
	`calendar_name` text,
	`include_detail` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` integer,
	`last_sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `calendar_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_targets_user_id_scope_unique` ON `calendar_targets` (`user_id`,`scope`);--> statement-breakpoint
CREATE TABLE `google_oauth_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`client_secret_encrypted` text,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
