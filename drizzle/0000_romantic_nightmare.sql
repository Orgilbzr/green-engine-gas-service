CREATE TABLE `bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer` text NOT NULL,
	`phone` text NOT NULL,
	`plate` text NOT NULL,
	`vehicle` text NOT NULL,
	`branch` text NOT NULL,
	`booking_date` text NOT NULL,
	`booking_time` text NOT NULL,
	`advance` integer DEFAULT 0 NOT NULL,
	`receipt` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Хүлээгдэж буй' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_branch_slot_unique` ON `bookings` (`branch`,`booking_date`,`booking_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_plate_slot_unique` ON `bookings` (`plate`,`booking_date`,`booking_time`);