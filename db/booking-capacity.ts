import { and, eq, isNotNull, ne } from "drizzle-orm";
import { bookings } from "./schema";

export const BOOKING_CAPACITY = 3;
export const BOOKING_CAPACITY_ERROR = "Энэ салбарын тухайн өдрийн 3 захиалгын орон тоо дүүрсэн байна.";
const CAPACITY_INDEX = "booking_branch_day_capacity_slot_unique";

type TransactionDatabase = any;
type BookingDatabase = any;

export function isCapacityConflict(error: unknown) {
  const databaseError = getPostgresError(error);
  return databaseError?.code === "23505" && databaseError.constraint === CAPACITY_INDEX;
}

export function getPostgresError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; detail?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" || typeof candidate.constraint === "string" || typeof candidate.detail === "string") {
      return {
        code: typeof candidate.code === "string" ? candidate.code : undefined,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : typeof candidate.constraint_name === "string" ? candidate.constraint_name : undefined,
        detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
      };
    }
    current = candidate.cause;
  }
  return null;
}

export async function findAvailableCapacitySlot(tx: TransactionDatabase, branch: string, bookingDate: string): Promise<1 | 2 | 3 | null> {
  const occupied = await tx.select({ capacitySlot: bookings.capacitySlot })
    .from(bookings)
    .where(and(
      eq(bookings.branch, branch),
      eq(bookings.bookingDate, bookingDate),
      isNotNull(bookings.capacitySlot),
      ne(bookings.status, "Цуцлагдсан"),
    ));
  const occupiedSlots = new Set(occupied.map((row: { capacitySlot: number | null }) => row.capacitySlot));
  for (let slot = 1; slot <= BOOKING_CAPACITY; slot += 1) {
    if (!occupiedSlots.has(slot)) return slot as 1 | 2 | 3;
  }
  return null;
}

export async function withBookingCapacity<T>(db: BookingDatabase, operation: (tx: TransactionDatabase) => Promise<T>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.transaction((tx: TransactionDatabase) => operation(tx));
    } catch (error) {
      if (!isCapacityConflict(error)) throw error;
    }
  }
  throw new Error(BOOKING_CAPACITY_ERROR);
}

export function bookingWithCapacitySlot(values: Record<string, unknown>, capacitySlot: number) {
  return { ...values, capacitySlot } as typeof bookings.$inferInsert;
}
