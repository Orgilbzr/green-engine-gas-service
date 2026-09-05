import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, integer, jsonb, pgTable, serial, smallint, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  bookingNo: text("booking_no").notNull(),
  customer: text("customer").notNull(),
  phone: text("phone").notNull(),
  plate: text("plate").notNull(),
  vehicle: text("vehicle").notNull(),
  manufactureYear: smallint("manufacture_year"),
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
  capacitySlot: smallint("capacity_slot"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("booking_plate_slot_unique").on(sql`upper(regexp_replace(btrim(${table.plate}), '[[:space:]]+', '', 'g'))`, table.bookingDate, table.bookingTime).where(sql`${table.status} not in ('Цуцлагдсан', 'cancelled')`),
  check("booking_capacity_slot_check", sql`${table.capacitySlot} is null or ${table.capacitySlot} between 1 and 3`),
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
  manufactureYear: smallint("manufacture_year"),
  source: text("source").notNull().default("manual"),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("new"),
  convertedBookingId: integer("converted_booking_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorUserId: integer("actor_user_id"),
  actorEmail: text("actor_email").notNull(),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  entityRef: text("entity_ref"),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_created_at_idx").on(table.createdAt),
  index("audit_logs_actor_email_idx").on(table.actorEmail),
  index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  index("audit_logs_action_idx").on(table.action),
]);
