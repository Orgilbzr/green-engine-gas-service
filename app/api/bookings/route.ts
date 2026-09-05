import { desc } from "drizzle-orm";
import { createRequestDiagnostics, databaseErrorResponse, getHealthyDb, isDatabaseConnectionError, logDatabaseError, logSlowOperation, NO_STORE_HEADERS, safeErrorResponse } from "../../../db";
import { bookings, products } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { bookingForRole, requireRole } from "../../authz";
import { writeAuditLog } from "../../audit";
import { bookingWithCapacitySlot, BOOKING_CAPACITY_ERROR, findAvailableCapacitySlot, getPostgresError, withBookingCapacity } from "../../../db/booking-capacity";
import { checkBookingDuplicates, duplicateResponse, normalizePlate } from "../../booking-duplicates";
import { manufactureYearDatabaseError, parseManufactureYear } from "../../manufacture-year";

export async function GET() {
  const diagnostics = createRequestDiagnostics("GET /api/bookings");
  diagnostics.stage("route_start");
  try {
    const auth = await requireRole(["admin", "operator", "mechanic"]); if ("response" in auth) return auth.response;
    diagnostics.stage("db_query_start");
    const db = await getHealthyDb();
    const rows = await db.select().from(bookings).orderBy(desc(bookings.bookingDate), desc(bookings.bookingTime), desc(bookings.id)).limit(500);
    diagnostics.stage("db_query_complete");
    diagnostics.stage("response");
    return Response.json({ bookings: rows.map((row) => bookingForRole({ ...row, date: row.bookingDate, time: row.bookingTime }, auth.user.role)) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    diagnostics.stage("response");
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Бүртгэл уншихад алдаа гарлаа.");
    return safeErrorResponse(error, "Бүртгэл уншихад алдаа гарлаа.");
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const diagnostics = createRequestDiagnostics("POST /api/bookings");
  try {
    const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
    const body = await request.json() as Record<string, unknown>;
    const required = ["customer", "phone", "plate", "vehicle", "branch", "date", "time"];
    if (required.some((key) => typeof body[key] !== "string" || !(body[key] as string).trim())) {
      return Response.json({ error: "Заавал бөглөх мэдээлэл дутуу байна." }, { status: 400 });
    }
    const productId = Number(body.productId);
    const db = await getHealthyDb();
    const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product || !product.active) return Response.json({ error: "Идэвхтэй бүтээгдэхүүн сонгоно уу." }, { status: 400 });
    const totalPrice = product.price;
    const advance = Math.max(0, Number(body.advance) || 0);
    const advanceType = typeof body.advanceType === "string" ? body.advanceType : null;
    const advanceNote = typeof body.advanceNote === "string" ? body.advanceNote.trim() : "";
    const manufactureYearResult = parseManufactureYear(body.manufactureYear);
    if (manufactureYearResult.error) return Response.json({ error: manufactureYearResult.error }, { status: 400 });
    const manufactureYear = manufactureYearResult.year!;
    if (!totalPrice) return Response.json({ error: "Нийт үнийн дүнг оруулна уу." }, { status: 400 });
    if (advance > totalPrice) return Response.json({ error: "Урьдчилгаа нийт үнээс их байж болохгүй." }, { status: 400 });
    const allowActiveOverride = body.duplicateOverride === true;
    const [row] = await withBookingCapacity(db, async (tx) => {
      const duplicate = await checkBookingDuplicates(tx, { phone: String(body.phone), plate: String(body.plate), bookingDate: String(body.date), bookingTime: String(body.time) });
      const duplicateError = duplicateResponse(duplicate, allowActiveOverride);
      if (duplicateError) throw Object.assign(new Error(duplicateError.body.error), { duplicateStatus: duplicateError.status, duplicateBody: duplicateError.body });
      const capacitySlot = await findAvailableCapacitySlot(tx, String(body.branch), String(body.date));
      if (capacitySlot === null) throw new Error(BOOKING_CAPACITY_ERROR);
      const [created] = await tx.insert(bookings).values(bookingWithCapacitySlot({
        customer: String(body.customer).trim(), phone: String(body.phone).trim(), plate: normalizePlate(String(body.plate)),
        vehicle: String(body.vehicle).trim(), manufactureYear, productId: product.id, productName: product.name, branch: String(body.branch), bookingDate: String(body.date), bookingTime: String(body.time),
        totalPrice, advance, finalPaid: 0, receipt: String(body.receipt ?? "").trim(), status: advance > 0 ? "Баталгаажсан" : "Хүлээгдэж буй",
        advanceType: advanceType && ["software", "device", "other"].includes(advanceType) ? advanceType : null,
        advanceNote: advanceType === "other" ? advanceNote.slice(0, 200) : "",
      }, capacitySlot)).returning();
      await writeAuditLog({ db: tx, actor: auth.user, action: "booking.created", entityType: "booking", entityId: created.id, entityRef: created.bookingNo, details: {
        booking_no: created.bookingNo, customer: created.customer, phone: created.phone, plate: created.plate, vehicle: created.vehicle, manufacture_year: created.manufactureYear, branch: created.branch, booking_date: created.bookingDate,
      }});
      return [created];
    });
    const response = Response.json({ booking: { ...row, date: row.bookingDate, time: row.bookingTime } }, { status: 201 });
    logSlowOperation("POST /api/bookings", startedAt, 201);
    return response;
  } catch (error) {
    diagnostics.stage("response");
    logSlowOperation("POST /api/bookings", startedAt, isDatabaseConnectionError(error) ? 503 : 500, isDatabaseConnectionError(error) ? "database" : undefined);
    const manufactureYearError = manufactureYearDatabaseError(error);
    if (manufactureYearError) return Response.json({ error: manufactureYearError }, { status: 400 });
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Захиалга хадгалахад алдаа гарлаа.", { route: "POST /api/bookings", requestId: diagnostics.requestId, stage: "booking_insert" });
    const message = error instanceof Error ? error.message : "Захиалга хадгалахад алдаа гарлаа.";
    if (message === BOOKING_CAPACITY_ERROR) return Response.json({ error: message }, { status: 409 });
    const duplicateError = error as Error & { duplicateStatus?: number; duplicateBody?: unknown };
    if (duplicateError.duplicateStatus) return Response.json(duplicateError.duplicateBody, { status: duplicateError.duplicateStatus });
    const databaseError = getPostgresError(error);
    if (databaseError?.code === "23505") {
      logDatabaseError(error, { route: "POST /api/bookings", requestId: diagnostics.requestId, stage: "booking_insert" });
      if (databaseError.constraint === "booking_plate_slot_unique") return Response.json({ error: "Энэ автомашин тухайн өдөр, цагт аль хэдийн бүртгэгдсэн байна." }, { status: 409 });
      if (databaseError.constraint === "booking_branch_day_capacity_slot_unique") return Response.json({ error: BOOKING_CAPACITY_ERROR }, { status: 409 });
      if (databaseError.constraint === "bookings_booking_no_unique") return Response.json({ error: "Захиалгын дугаар давхардаж байна. Дахин оролдоно уу." }, { status: 409 });
      return Response.json({ error: "Давхардсан бүртгэл илэрлээ. Мэдээллээ шалгаад дахин оролдоно уу." }, { status: 409 });
    }
    return safeErrorResponse(error, "Захиалга хадгалахад алдаа гарлаа.");
  }
}
