ALTER TABLE `users` ADD `reset_token_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `reset_token_expires` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `password_changed_at` integer;