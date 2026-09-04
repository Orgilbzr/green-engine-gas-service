import { eq } from "drizzle-orm";
import { requireRole } from "../../../authz";
import { createChangeSet, writeAuditLog } from "../../../audit";
import { databaseErrorResponse, getDb, isDatabaseConnectionError, safeErrorResponse } from "../../../../db";
import { bookings, preBookings, products } from "../../../../db/schema";
import { bookingWithCapacitySlot, BOOKING_CAPACITY_ERROR, withBookingCapacity } from "../../../../db/booking-capacity";

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

    const [row] = await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(preBookings).where(eq(preBookings.id, preorderId)).limit(1);
      if (!current) return [];
      const [updated] = await tx.update(preBookings).set(values).where(eq(preBookings.id, preorderId)).returning();
      const changes = createChangeSet(current, updated, ["status"]);
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

    const bookingValues = {
      customer: String(body.customer).trim(),
      phone: String(body.phone).trim(),
      plate: String(body.plate).trim().toUpperCase(),
      vehicle: String(body.vehicle).trim(),
      productId: Number(body.productId) || null,
      productName: String(body.productName || ""),
      branch: String(body.branch),
      bookingDate: String(body.date),
      bookingTime: String(body.time),
      totalPrice: Number(body.totalPrice) || 0,
      advance: Math.max(0, Number(body.advance) || 0),
      finalPaid: 0,
      receipt: String(body.receipt ?? "").trim(),
      status: Number(body.advance) > 0 ? "Баталгаажсан" : "Хүлээгдэж буй",
      advanceType: typeof body.advanceType === "string" ? body.advanceType : null,
      advanceNote: typeof body.advanceNote === "string" ? body.advanceNote.trim().slice(0, 200) : "",
    };

    const { row } = await withBookingCapacity(getDb(), async (tx, capacitySlot) => {
      const [currentPreOrder] = await tx.select().from(preBookings).where(eq(preBookings.id, preorderId)).limit(1);
      if (!currentPreOrder) throw new Error("Урьдчилсан захиалга олдсонгүй.");
      if (currentPreOrder.status === "converted" && currentPreOrder.convertedBookingId) throw new Error("Энэ урьдчилсан захиалга аль хэдийн үндсэн захиалгад хөрвүүлэгдсэн байна.");
      const [created] = await tx.insert(bookings).values(bookingWithCapacitySlot(bookingValues, capacitySlot)).returning();
      await tx.update(preBookings).set({ status: "converted", convertedBookingId: created.id, updatedAt: new Date() }).where(eq(preBookings.id, preorderId));
      await writeAuditLog({ db: tx, actor: auth.user, action: "preorder.converted", entityType: "preorder", entityId: preOrder.id, entityRef: `PRE-${preOrder.id}`, details: { booking_no: created.bookingNo } });
      await writeAuditLog({ db: tx, actor: auth.user, action: "booking.created", entityType: "booking", entityId: created.id, entityRef: created.bookingNo, details: { customer: created.customer, plate: created.plate, branch: created.branch, booking_date: created.bookingDate } });
      return { row: created };
    });
    return Response.json({ booking: { ...row, date: row.bookingDate, time: row.bookingTime }, preBooking: { ...preOrder, status: "converted", convertedBookingId: row.id } }, { status: 201 });
  } catch (error) {
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Захиалга хадгалах боломжгүй.");
    const message = error instanceof Error ? error.message : "Захиалга хадгалах боломжгүй.";
    if (message === BOOKING_CAPACITY_ERROR) return Response.json({ error: message }, { status: 409 });
    if (message.includes("booking_plate_slot_unique") || message.includes("UNIQUE constraint failed")) return Response.json({ error: "Сонгосон цагт энэ улсын дугаартай захиалга байна." }, { status: 409 });
    return safeErrorResponse(error, "Захиалга хадгалах боломжгүй.");
  }
}
