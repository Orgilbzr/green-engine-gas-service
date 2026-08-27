import { bigint, boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customer: text("customer").notNull(),
  phone: text("phone").notNull(),
  plate: text("plate").notNull(),
  vehicle: text("vehicle").notNull(),
  productId: integer("product_id"),
  productName: text("product_name").notNull().default(""),
  branch: text("branch").notNull(),
  bookingDate: text("booking_date").notNull(),
  bookingTime: text("booking_time").notNull(),
  totalPrice: integer("total_price").notNull().default(0),
  advance: integer("advance").notNull().default(0),
  finalPaid: integer("final_paid").notNull().default(0),
  receipt: text("receipt").notNull().default(""),
  status: text("status").notNull().default("Хүлээгдэж буй"),
  advanceType: text("advance_type"),
  advanceNote: text("advance_note").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("booking_branch_day_unique").on(table.branch, table.bookingDate),
  uniqueIndex("booking_plate_slot_unique").on(table.plate, table.bookingDate, table.bookingTime),
]);

export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loginSessions = pgTable("login_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  price: integer("price").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const preBookings = pgTable("pre_bookings", {
  id: serial("id").primaryKey(),
  customer: text("customer").notNull(),
  phone: text("phone").notNull(),
  vehicle: text("vehicle").notNull(),
  plate: text("plate"),
  source: text("source").notNull().default("manual"),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("new"),
  convertedBookingId: integer("converted_booking_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
