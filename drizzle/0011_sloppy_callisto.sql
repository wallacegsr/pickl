CREATE TABLE `recipe_tags` (
	`recipe_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_tags_recipe_id_tag_id_unique` ON `recipe_tags` (`recipe_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_key_unique` ON `tags` (`name_key`);--> statement-breakpoint
-- Data migration: carry the comma-separated `recipes.tags` column across
-- into the tags / recipe_tags tables. The column itself is dropped in the
-- NEXT migration, so this one is purely additive and the old values are
-- still readable while it runs.
--
-- The recursive CTE splits each recipe's `tags` on commas by repeatedly
-- biting off the text before the first comma (a trailing ',' is appended to
-- the seed so the last item is terminated like every other one). Blank
-- pieces from empty tags ("a,,b") fall out in the WHERE below.
--
-- No-op (0 rows) on a fresh database with no recipes.
INSERT INTO `tags` (`id`, `name`, `name_key`, `created_by_user_id`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
		substr(lower(hex(randomblob(2))), 2) || '-a' ||
		substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	-- Display name: when several spellings of the same tag exist across
	-- recipes ("Quick" and "quick"), keep one — tag names are compared
	-- case-insensitively. Every recipe still keeps its association, since
	-- the join below matches on the same case-folded key.
	min(`display_name`),
	`name_key`,
	NULL,
	unixepoch(),
	unixepoch()
FROM (
	WITH RECURSIVE `split`(`recipe_id`, `piece`, `rest`) AS (
		SELECT `id`, '', `tags` || ',' FROM `recipes` WHERE trim(`tags`) <> ''
		UNION ALL
		SELECT `recipe_id`, substr(`rest`, 1, instr(`rest`, ',') - 1), substr(`rest`, instr(`rest`, ',') + 1)
		FROM `split` WHERE `rest` <> ''
	)
	SELECT
		trim(replace(replace(`piece`, char(9), ' '), char(10), ' ')) AS `display_name`,
		replace(replace(replace(lower(trim(replace(replace(`piece`, char(9), ' '), char(10), ' '))), '  ', ' '), '  ', ' '), '  ', ' ') AS `name_key`
	FROM `split`
	WHERE trim(`piece`) <> ''
)
GROUP BY `name_key`
ON CONFLICT(`name_key`) DO NOTHING;--> statement-breakpoint
INSERT INTO `recipe_tags` (`recipe_id`, `tag_id`)
SELECT DISTINCT `s`.`recipe_id`, `t`.`id`
FROM (
	WITH RECURSIVE `split`(`recipe_id`, `piece`, `rest`) AS (
		SELECT `id`, '', `tags` || ',' FROM `recipes` WHERE trim(`tags`) <> ''
		UNION ALL
		SELECT `recipe_id`, substr(`rest`, 1, instr(`rest`, ',') - 1), substr(`rest`, instr(`rest`, ',') + 1)
		FROM `split` WHERE `rest` <> ''
	)
	SELECT
		`recipe_id`,
		replace(replace(replace(lower(trim(replace(replace(`piece`, char(9), ' '), char(10), ' '))), '  ', ' '), '  ', ' '), '  ', ' ') AS `name_key`
	FROM `split`
	WHERE trim(`piece`) <> ''
) AS `s`
JOIN `tags` AS `t` ON `t`.`name_key` = `s`.`name_key`
ON CONFLICT(`recipe_id`, `tag_id`) DO NOTHING;
