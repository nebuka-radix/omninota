CREATE TABLE `note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`name` varchar(96) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_on` datetime NOT NULL,
	`updated_on` datetime NOT NULL,
	CONSTRAINT "note_name_length" CHECK(length("note"."name") between 1 and 96),
	CONSTRAINT "note_favorite_boolean" CHECK("note"."favorite" in (0, 1)),
	CONSTRAINT "note_active_boolean" CHECK("note"."active" in (0, 1))
);
