CREATE TABLE `gather_players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gather_id` integer NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`joined_at` text NOT NULL,
	FOREIGN KEY (`gather_id`) REFERENCES `gathers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gathers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text,
	`time` text NOT NULL,
	`max_players` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
