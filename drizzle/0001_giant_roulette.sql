DROP INDEX `booking_branch_slot_unique`;--> statement-breakpoint
ALTER TABLE `bookings` ADD `total_price` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `final_paid` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_branch_day_unique` ON `bookings` (`branch`,`booking_date`);