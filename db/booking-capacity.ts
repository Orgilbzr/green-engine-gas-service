import { bookings } from "./schema";

export const BOOKING_CAPACITY = 3;
export const BOOKING_CAPACITY_ERROR = "Энэ салбарын тухайн өдрийн 3 захиалгын орон тоо дүүрсэн байна.";
const CAPACITY_INDEX = "booking_branch_day_capacity_slot_unique";

type TransactionDatabase = any;
type BookingDatabase = any;

export function isCapacityConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const databaseError = error as { code?: string; constraint?: string; constraint_name?: string };
  return databaseError.code === "23505" && (databaseError.constraint === CAPACITY_INDEX || databaseError.constraint_name === CAPACITY_INDEX);
}

export async function withBookingCapacity<T>(db: BookingDatabase, operation: (tx: TransactionDatabase, capacitySlot: number) => Promise<T>) {
  for (let capacitySlot = 1; capacitySlot <= BOOKING_CAPACITY; capacitySlot += 1) {
    try {
      return await db.transaction((tx: TransactionDatabase) => operation(tx, capacitySlot));
    } catch (error) {
      if (!isCapacityConflict(error)) throw error;
    }
  }
  throw new Error(BOOKING_CAPACITY_ERROR);
}

export function bookingWithCapacitySlot(values: Record<string, unknown>, capacitySlot: number) {
  return { ...values, capacitySlot } as typeof bookings.$inferInsert;
}
