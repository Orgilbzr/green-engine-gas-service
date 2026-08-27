-- Create pre_bookings table for preorder requests
CREATE TABLE IF NOT EXISTS "pre_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle" text NOT NULL,
	"plate" text,
	"source" text NOT NULL DEFAULT 'manual',
	"note" text NOT NULL DEFAULT '',
	"status" text NOT NULL DEFAULT 'new',
	"converted_booking_id" integer,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Add advance_type and advance_note columns to bookings table
ALTER TABLE "bookings" ADD COLUMN "advance_type" text;
ALTER TABLE "bookings" ADD COLUMN "advance_note" text NOT NULL DEFAULT '';
