CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`scope` text,
	`target_user_id` text,
	`date` text,
	`meal_type` text,
	`old_recipe_id` text,
	`new_recipe_id` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`meal_type` text DEFAULT 'dinner' NOT NULL,
	`recipe_id` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_entries_date_scope_user_id_meal_type_unique` ON `plan_entries` (`date`,`scope`,`user_id`,`meal_type`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ingredients` text NOT NULL,
	`instructions` text NOT NULL,
	`prep_time_minutes` integer,
	`cook_time_minutes` integer,
	`servings` integer,
	`tags` text DEFAULT '' NOT NULL,
	`source_url` text,
	`notes` text,
	`visibility` text DEFAULT 'shared' NOT NULL,
	`owner_user_id` text,
	`meal_type` text DEFAULT 'any' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`email_verified` integer,
	`verification_token` text,
	`verification_token_expires` integer,
	`role` text DEFAULT 'member' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`can_access_shared_calendar` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);