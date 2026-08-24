import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("booking_branch_day_unique").on(table.branch, table.bookingDate),
  uniqueIndex("booking_plate_slot_unique").on(table.plate, table.bookingDate, table.bookingTime),
]);

export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const loginSessions = sqliteTable("login_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  price: integer("price").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
