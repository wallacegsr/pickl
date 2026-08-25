ALTER TABLE `users` ADD `pending_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pending_email_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pending_email_token_expires` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `theme_preference` text DEFAULT 'system' NOT NULL;