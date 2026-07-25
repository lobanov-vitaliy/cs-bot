CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_chat_id_id_idx` ON `chat_messages` (`chat_id`,`id`);