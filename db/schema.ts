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
  programmingCompleted: boolean("programming_completed").notNull().default(false),
  programmingCompletedAt: timestamp("programming_completed_at", { withTimezone: true }),
  programmingCompletedBy: jsonb("programming_completed_by").$type<{ id: number | null; name: string; role: string }>(),
  installationCompleted: boolean("installation_completed").notNull().default(false),
  installationCompletedAt: timestamp("installation_completed_at", { withTimezone: true }),
  installationCompletedBy: jsonb("installation_completed_by").$type<{ id: number | null; name: string; role: string }>(),
  handoverCompleted: boolean("handover_completed").notNull().default(false),
  handoverCompletedAt: timestamp("handover_completed_at", { withTimezone: true }),
  handoverCompletedBy: jsonb("handover_completed_by").$type<{ id: number | null; name: string; role: string }>(),
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
}, (table) => [index("pre_bookings_converted_booking_idx").on(table.convertedBookingId)]);

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

export const serviceVisits = pgTable("service_visits", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  bookingNo: text("booking_no").notNull(),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull(),
  purpose: text("purpose").notNull(),
  branch: text("branch").notNull(),
  note: text("note").notNull().default(""),
  recordedBy: jsonb("recorded_by").$type<{ id: number | null; name: string; role: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("service_visits_booking_idx").on(table.bookingId), check("service_visits_purpose_check", sql`${table.purpose} in ('programming', 'installation', 'inspection', 'other')`)]);

// Immutable author snapshot also supports the built-in admin (no app_users row).
export const bookingNotes = pgTable("booking_notes", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
  preBookingId: integer("pre_booking_id").references(() => preBookings.id, { onDelete: "restrict" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: jsonb("created_by").$type<{ id: number | null; name: string; role: string }>().notNull(),
  legacy: boolean("legacy").notNull().default(false),
}, (table) => [
  check("booking_notes_owner_check", sql`num_nonnulls(${table.bookingId}, ${table.preBookingId}) = 1`),
  check("booking_notes_text_check", sql`length(btrim(${table.note})) between 1 and 2000`),
  index("booking_notes_booking_idx").on(table.bookingId, table.createdAt, table.id),
  index("booking_notes_prebooking_idx").on(table.preBookingId, table.createdAt, table.id),
]);
