CREATE TABLE `chat_members` (
	`chat_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`chat_id`, `user_id`)
);
