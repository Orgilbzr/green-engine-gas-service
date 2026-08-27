CREATE TABLE IF NOT EXISTS "bookings" (
  "id" serial PRIMARY KEY,
  "customer" text NOT NULL,
  "phone" text NOT NULL,
  "plate" text NOT NULL,
  "vehicle" text NOT NULL,
  "product_id" integer,
  "product_name" text NOT NULL DEFAULT '',
  "branch" text NOT NULL,
  "booking_date" text NOT NULL,
  "booking_time" text NOT NULL,
  "total_price" integer NOT NULL DEFAULT 0,
  "advance" integer NOT NULL DEFAULT 0,
  "final_paid" integer NOT NULL DEFAULT 0,
  "receipt" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'Хүлээгдэж буй',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_branch_day_unique"
  ON "bookings" ("branch", "booking_date");

CREATE UNIQUE INDEX IF NOT EXISTS "booking_plate_slot_unique"
  ON "bookings" ("plate", "booking_date", "booking_time");

CREATE TABLE IF NOT EXISTS "app_users" (
  "id" serial PRIMARY KEY,
  "email" text NOT NULL,
  "password_hash" text,
  "role" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_users_email_unique"
  ON "app_users" ("email");

CREATE TABLE IF NOT EXISTS "login_sessions" (
  "id" serial PRIMARY KEY,
  "token_hash" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "products" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "price" integer NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "products_name_unique"
  ON "products" ("name");
