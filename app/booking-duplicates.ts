import { and, desc, eq, or, sql } from "drizzle-orm";
import { bookings } from "../db/schema";

type BookingDatabase = any;

export const DUPLICATE_PHONE_WARNING = "Энэ утасны дугаараар өмнө бүртгэл байна.";
export const DUPLICATE_PLATE_WARNING = "Энэ автомашин өмнө бүртгэгдсэн байна.";
export const DUPLICATE_ACTIVE_WARNING = "Энэ автомашинд идэвхтэй захиалга байна.";
export const DUPLICATE_EXACT_ERROR = "Энэ автомашин тухайн өдөр, цагт аль хэдийн бүртгэгдсэн байна.";

export function normalizePhone(value: string) {
  return value.trim().replace(/[^0-9]/g, "");
}

export function normalizePlate(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function phoneExpression(column: unknown) {
  return sql`regexp_replace(${column}, '[^0-9]', '', 'g')`;
}

function plateExpression(column: unknown) {
  return sql`regexp_replace(upper(${column}), '\\s+', '', 'g')`;
}

function isCancelled(status: string) {
  return status === "Цуцлагдсан" || status === "cancelled";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export type DuplicateCheckResult = {
  phoneMatch?: { customer: string; plate: string; latestBookingDate: string };
  plateHistory?: { plate: string; vehicle: string; manufactureYear: number | null; bookingNo: string; bookingDate: string; status: string };
  activeBooking?: { bookingNo: string; branch: string; bookingDate: string; bookingTime: string; status: string };
  exactDuplicate?: boolean;
};

export async function checkBookingDuplicates(
  db: BookingDatabase,
  input: { phone?: string; plate?: string; bookingDate?: string; bookingTime?: string; excludeId?: number },
): Promise<DuplicateCheckResult> {
  const phone = normalizePhone(input.phone || "");
  const plate = normalizePlate(input.plate || "");
  if (!phone && !plate) return {};
  const predicates = [];
  if (phone) predicates.push(sql`${phoneExpression(bookings.phone)} = ${phone}`);
  if (plate) predicates.push(sql`${plateExpression(bookings.plate)} = ${plate}`);
  const rows = await db.select({
    id: bookings.id,
    bookingNo: bookings.bookingNo,
    customer: bookings.customer,
    phone: bookings.phone,
    plate: bookings.plate,
    vehicle: bookings.vehicle,
    manufactureYear: bookings.manufactureYear,
    branch: bookings.branch,
    bookingDate: bookings.bookingDate,
    bookingTime: bookings.bookingTime,
    status: bookings.status,
  }).from(bookings).where(and(or(...predicates), input.excludeId ? sql`${bookings.id} <> ${input.excludeId}` : undefined)).orderBy(desc(bookings.bookingDate), desc(bookings.bookingTime), desc(bookings.id)).limit(50);
  const result: DuplicateCheckResult = {};
  const phoneRow = rows.find((row: typeof bookings.$inferSelect) => phone && normalizePhone(row.phone) === phone);
  if (phoneRow) result.phoneMatch = { customer: phoneRow.customer, plate: phoneRow.plate, latestBookingDate: phoneRow.bookingDate };
  const plateRows = rows.filter((row: typeof bookings.$inferSelect) => plate && normalizePlate(row.plate) === plate);
  const latest = plateRows[0];
  if (latest) {
    result.plateHistory = { plate: latest.plate, vehicle: latest.vehicle, manufactureYear: latest.manufactureYear, bookingNo: latest.bookingNo, bookingDate: latest.bookingDate, status: latest.status };
    if (input.bookingDate && input.bookingTime) {
      result.exactDuplicate = plateRows.some((row: typeof bookings.$inferSelect) => !isCancelled(row.status) && row.bookingDate === input.bookingDate && row.bookingTime === input.bookingTime);
    }
    const active = plateRows.find((row: typeof bookings.$inferSelect) => !isCancelled(row.status) && row.bookingDate >= (input.bookingDate || today()));
    if (active) result.activeBooking = { bookingNo: active.bookingNo, branch: active.branch, bookingDate: active.bookingDate, bookingTime: active.bookingTime, status: active.status };
  }
  return result;
}

export function duplicateResponse(result: DuplicateCheckResult, allowActiveOverride = false) {
  if (result.exactDuplicate) return { status: 409, body: { error: DUPLICATE_EXACT_ERROR, duplicate: result } };
  if (result.activeBooking && !allowActiveOverride) return { status: 409, body: { error: DUPLICATE_ACTIVE_WARNING, duplicate: result, requiresConfirmation: true } };
  return null;
}
