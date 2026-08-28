import { and, eq, ne, sql } from "drizzle-orm";
import { bookings } from "./schema";

export const BOOKING_CAPACITY = 3;
export const BOOKING_CAPACITY_ERROR = "Энэ салбарын тухайн өдрийн 3 захиалгын орон тоо дүүрсэн байна.";

export async function assertBookingCapacity(tx: any, branch: string, bookingDate: string, excludeBookingId?: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${branch}\0${bookingDate}`}, 0))`);
  const conditions = [
    eq(bookings.branch, branch),
    eq(bookings.bookingDate, bookingDate),
    ne(bookings.status, "Цуцлагдсан"),
    ne(bookings.status, "cancelled"),
  ];
  if (excludeBookingId !== undefined) conditions.push(ne(bookings.id, excludeBookingId));
  const [result] = await tx.select({ count: sql<number>`count(*)` }).from(bookings).where(and(...conditions));
  if (Number(result?.count ?? 0) >= BOOKING_CAPACITY) throw new Error(BOOKING_CAPACITY_ERROR);
}