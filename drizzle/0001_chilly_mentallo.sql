CREATE TABLE `shopping_list_status` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`meal_type` text NOT NULL,
	`ingredient_text` text NOT NULL,
	`on_hand` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_status_scope_user_id_date_meal_type_ingredient_text_unique` ON `shopping_list_status` (`scope`,`user_id`,`date`,`meal_type`,`ingredient_text`);