CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_pass_encrypted` text,
	`smtp_from` text,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
