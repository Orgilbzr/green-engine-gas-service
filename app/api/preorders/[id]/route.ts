import { eq } from "drizzle-orm";
import { requireRole } from "../../../authz";
import { createChangeSet, writeAuditLog } from "../../../audit";
import { createRequestDiagnostics, databaseErrorResponse, getDb, isDatabaseConnectionError, logDatabaseError, safeErrorResponse } from "../../../../db";
import { bookings, preBookings, products } from "../../../../db/schema";
import { bookingWithCapacitySlot, BOOKING_CAPACITY_ERROR, findAvailableCapacitySlot, getPostgresError, withBookingCapacity } from "../../../../db/booking-capacity";
import { checkBookingDuplicates, duplicateResponse, normalizePlate } from "../../../booking-duplicates";
import { LEGACY_PREORDER_YEAR_REQUIRED, manufactureYearDatabaseError, parseManufactureYear } from "../../../manufacture-year";

const PREORDER_STATUSES = new Set(["new", "contacted", "converted", "cancelled"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(["admin", "operator"]);
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const preorderId = Number(id);
    const body = await request.json() as Record<string, unknown>;

    if (!Number.isInteger(preorderId)) {
      return Response.json({ error: "Урьдчилсан захиалгын дугаар буруу байна." }, { status: 400 });
    }

    const nextStatus = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (nextStatus && !PREORDER_STATUSES.has(nextStatus)) {
      return Response.json({ error: "Зөвшөөрөгдсөн төлөв сонгоно уу." }, { status: 400 });
    }

    const values: Record<string, unknown> = {};
    if (nextStatus) values.status = nextStatus;
    if (body.manufactureYear !== undefined) {
      const manufactureYearResult = parseManufactureYear(body.manufactureYear, false);
      if (manufactureYearResult.error) return Response.json({ error: manufactureYearResult.error }, { status: 400 });
      values.manufactureYear = manufactureYearResult.year;
    }

    const [row] = await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(preBookings).where(eq(preBookings.id, preorderId)).limit(1);
      if (!current) return [];
      const [updated] = await tx.update(preBookings).set(values).where(eq(preBookings.id, preorderId)).returning();
      const changes = createChangeSet(current, updated, ["status", "manufactureYear"]);
      if (Object.keys(changes).length) await writeAuditLog({ db: tx, actor: auth.user, action: updated.status === "cancelled" ? "preorder.cancelled" : "preorder.updated", entityType: "preorder", entityId: updated.id, entityRef: `PRE-${updated.id}`, details: changes });
      return [updated];
    });
    if (!row) return Response.json({ error: "Урьдчилсан захиалга олдсонгүй." }, { status: 404 });

    return Response.json({ preBooking: row });
  } catch (error) {
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Шинэчлэх боломжгүй.");
    return safeErrorResponse(error, "Шинэчлэх боломжгүй.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnostics = createRequestDiagnostics("POST /api/preorders/[id]");
  try {
    const auth = await requireRole(["admin", "operator"]);
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const preorderId = Number(id);
    const body = await request.json() as Record<string, unknown>;

    if (!Number.isInteger(preorderId)) {
      return Response.json({ error: "Урьдчилсан захиалгын дугаар буруу байна." }, { status: 400 });
    }

    const [preOrder] = await getDb().select().from(preBookings).where(eq(preBookings.id, preorderId)).limit(1);
    if (!preOrder) return Response.json({ error: "Урьдчилсан захиалга олдсонгүй." }, { status: 404 });
    if (preOrder.status === "converted" && preOrder.convertedBookingId) {
      return Response.json({ error: "Энэ урьдчилсан захиалга аль хэдийн үндсэн захиалгад хөрвүүлэгдсэн байна." }, { status: 409 });
    }

    const required = ["customer", "phone", "plate", "vehicle", "branch", "date", "time"];
    if (required.some((key) => typeof body[key] !== "string" || !(body[key] as string).trim())) {
      return Response.json({ error: "Заавал бөглөх мэдээлэл дутуу байна." }, { status: 400 });
    }

    const productId = Number(body.productId);
    const [product] = await getDb().select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product || !product.active) {
      return Response.json({ error: "Идэвхтэй бүтээгдэхүүн сонгоно уу." }, { status: 400 });
    }

    const manufactureYear = preOrder.manufactureYear;
    if (manufactureYear === null) return Response.json({ error: LEGACY_PREORDER_YEAR_REQUIRED }, { status: 400 });
    const allowActiveOverride = body.duplicateOverride === true;
    const bookingValues = {
      customer: String(body.customer).trim(),
      phone: String(body.phone).trim(),
      plate: normalizePlate(String(body.plate)),
      vehicle: String(body.vehicle).trim(),
      manufactureYear,
      productId: product.id,
      productName: product.name,
      branch: String(body.branch),
      bookingDate: String(body.date),
      bookingTime: String(body.time),
      totalPrice: product.price,
      advance: Math.min(product.price, Math.max(0, Number(body.advance) || 0)),
      finalPaid: 0,
      receipt: String(body.receipt ?? "").trim(),
      status: Number(body.advance) > 0 ? "Баталгаажсан" : "Хүлээгдэж буй",
      advanceType: typeof body.advanceType === "string" ? body.advanceType : null,
      advanceNote: typeof body.advanceNote === "string" ? body.advanceNote.trim().slice(0, 200) : "",
    };

    const { row } = await withBookingCapacity(getDb(), async (tx) => {
      const [currentPreOrder] = await tx.select().from(preBookings).where(eq(preBookings.id, preorderId)).limit(1);
      if (!currentPreOrder) throw new Error("Урьдчилсан захиалга олдсонгүй.");
      if (currentPreOrder.status === "converted" && currentPreOrder.convertedBookingId) throw new Error("Энэ урьдчилсан захиалга аль хэдийн үндсэн захиалгад хөрвүүлэгдсэн байна.");
      if (currentPreOrder.manufactureYear === null) throw new Error(LEGACY_PREORDER_YEAR_REQUIRED);
      const duplicate = await checkBookingDuplicates(tx, { phone: bookingValues.phone, plate: bookingValues.plate, bookingDate: bookingValues.bookingDate, bookingTime: bookingValues.bookingTime });
      const duplicateError = duplicateResponse(duplicate, allowActiveOverride);
      if (duplicateError) throw Object.assign(new Error(duplicateError.body.error), { duplicateStatus: duplicateError.status, duplicateBody: duplicateError.body });
      const capacitySlot = await findAvailableCapacitySlot(tx, bookingValues.branch, bookingValues.bookingDate);
      if (capacitySlot === null) throw new Error(BOOKING_CAPACITY_ERROR);
      const [created] = await tx.insert(bookings).values(bookingWithCapacitySlot({ ...bookingValues, manufactureYear: currentPreOrder.manufactureYear }, capacitySlot)).returning();
      await tx.update(preBookings).set({ status: "converted", convertedBookingId: created.id, updatedAt: new Date() }).where(eq(preBookings.id, preorderId));
      await writeAuditLog({ db: tx, actor: auth.user, action: "preorder.converted", entityType: "preorder", entityId: preOrder.id, entityRef: `PRE-${preOrder.id}`, details: { booking_no: created.bookingNo } });
      await writeAuditLog({ db: tx, actor: auth.user, action: "booking.created", entityType: "booking", entityId: created.id, entityRef: created.bookingNo, details: { booking_no: created.bookingNo, customer: created.customer, phone: created.phone, plate: created.plate, vehicle: created.vehicle, manufacture_year: created.manufactureYear, branch: created.branch, booking_date: created.bookingDate } });
      return { row: created };
    });
    return Response.json({ booking: { ...row, date: row.bookingDate, time: row.bookingTime }, preBooking: { ...preOrder, status: "converted", convertedBookingId: row.id } }, { status: 201 });
  } catch (error) {
    diagnostics.stage("response");
    const manufactureYearError = manufactureYearDatabaseError(error);
    if (manufactureYearError) return Response.json({ error: manufactureYearError }, { status: 400 });
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Захиалга хадгалах боломжгүй.", { route: "POST /api/preorders/[id]", requestId: diagnostics.requestId, stage: "booking_insert" });
    const message = error instanceof Error ? error.message : "Захиалга хадгалах боломжгүй.";
    if (message === BOOKING_CAPACITY_ERROR) return Response.json({ error: message }, { status: 409 });
    const duplicateError = error as Error & { duplicateStatus?: number; duplicateBody?: unknown };
    if (duplicateError.duplicateStatus) return Response.json(duplicateError.duplicateBody, { status: duplicateError.duplicateStatus });
    const databaseError = getPostgresError(error);
    if (databaseError?.code === "23505") {
      logDatabaseError(error, { route: "POST /api/preorders/[id]", requestId: diagnostics.requestId, stage: "booking_insert" });
      if (databaseError.constraint === "booking_branch_day_capacity_slot_unique") return Response.json({ error: "Сонгосон өдрийн сул орон тоо өөрчлөгдсөн байна. Дахин оролдоно уу." }, { status: 409 });
      if (databaseError.constraint === "booking_plate_slot_unique") return Response.json({ error: "Энэ автомашин тухайн өдөр, цагт аль хэдийн бүртгэгдсэн байна." }, { status: 409 });
      if (databaseError.constraint === "bookings_booking_no_unique") return Response.json({ error: "Захиалгын дугаар давхардаж байна. Дахин оролдоно уу." }, { status: 409 });
      return Response.json({ error: "Давхардсан бүртгэл илэрлээ. Мэдээллээ шалгаад дахин оролдоно уу." }, { status: 409 });
    }
    return safeErrorResponse(error, "Захиалга хадгалах боломжгүй.");
  }
}
