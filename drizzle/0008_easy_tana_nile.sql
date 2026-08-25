ALTER TABLE `calendar_accounts` ADD `caldav_server_url` text;--> statement-breakpoint
ALTER TABLE `calendar_accounts` ADD `caldav_username` text;--> statement-breakpoint
ALTER TABLE `calendar_accounts` ADD `caldav_password_encrypted` text;--> statement-breakpoint
ALTER TABLE `calendar_accounts` ADD `caldav_home_url` text;--> statement-breakpoint
ALTER TABLE `calendar_event_links` ADD `etag` text;