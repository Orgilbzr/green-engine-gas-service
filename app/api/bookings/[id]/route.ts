import { notesCondition } from "../../../../db/notes";
import { readValidatedBody, validId, inputErrorResponse, InputError } from "../../../input-validation";
import { checkRequestOrigin } from "../../../request-origin";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { databaseErrorResponse, getHealthyDb, isDatabaseConnectionError, safeErrorResponse } from "../../../../db";
import { auditLogs, bookings, bookingNotes, preBookings, serviceVisits } from "../../../../db/schema";
import { requireRole } from "../../../authz";
import { createChangeSet, writeAuditLog } from "../../../audit";
import { BOOKING_CAPACITY_ERROR, findAvailableCapacitySlot, withBookingCapacity } from "../../../../db/booking-capacity";
import { manufactureYearDatabaseError, parseManufactureYear } from "../../../manufacture-year";
import { isReturnedBooking, returnedBookingConflict } from "../../../operations-0015";
import { hasBookingDeleteEvidence } from "../../../booking-delete";
import { paymentFinalPaid, PaymentConflictError } from "../../../booking-payment";

const protectedBookingMessage = "Үйлчилгээ, төлбөр эсвэл түүх бүртгэгдсэн захиалгыг устгах боломжгүй.";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const rejectedOrigin = checkRequestOrigin(request);
  if (rejectedOrigin) return rejectedOrigin;
 try{
  const auth=await requireRole(["admin","operator"]);if("response" in auth)return auth.response;
  const {id}=await params; const bookingId=validId(id); const body=await readValidatedBody(request, "booking-patch");
  const paymentRequestId = body.paymentAmount !== undefined ? request.headers.get("Idempotency-Key")?.toLowerCase() : undefined;
  if (body.paymentAmount !== undefined && (!paymentRequestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(paymentRequestId))) {
    throw new InputError("Төлбөрийн хүсэлтийн дугаар буруу байна.");
  }
  if(!Number.isInteger(bookingId))return Response.json({error:"Захиалгын дугаар буруу байна."},{status:400});
  const values:Record<string,unknown>={};
  if(typeof body.branch==="string")values.branch=body.branch;
  if(typeof body.date==="string")values.bookingDate=body.date;
  if(typeof body.time==="string")values.bookingTime=body.time;
  if(body.manufactureYear !== undefined) {
    const manufactureYearResult = parseManufactureYear(body.manufactureYear, false);
    if (manufactureYearResult.error) return Response.json({error:manufactureYearResult.error},{status:400});
    values.manufactureYear = manufactureYearResult.year;
  }
  if(typeof body.status==="string")values.status=body.status;
  if(typeof body.advanceType === "string") values.advanceType = ["software", "device", "other"].includes(body.advanceType) ? body.advanceType : null;
  if(typeof body.advanceNote === "string") values.advanceNote = body.advanceNote.trim();
    const db = await getHealthyDb();
    const [row]=await withBookingCapacity(db, async (tx) => {
     const [current]=await tx.select().from(bookings).where(eq(bookings.id,bookingId)).limit(1).for("update");
     if(!current)return [];
     if(await isReturnedBooking(tx, bookingId)) throw new Error("RETURNED_BOOKING");
     if (body.completePayment || body.finalPaid !== undefined || body.paymentAmount !== undefined) {
       // Protect financial writes by lineage even when the 0015 switch is off.
       const [lineage] = await tx.select({ retained: sql<boolean>`
         ((to_jsonb(${bookings})->>'returned_to_preorder_at') is not null
           or exists (select 1 from public.pre_bookings p
             where (to_jsonb(p)->>'returned_from_booking_id')::integer = public.bookings.id))`
       }).from(bookings).where(eq(bookings.id, bookingId));
       if (lineage?.retained) throw new Error("RETURNED_BOOKING");
       if (paymentRequestId && (current.status === "cancelled" || current.status === "Цуцлагдсан")) {
         throw new PaymentConflictError("Цуцлагдсан захиалгын төлбөрийг авах боломжгүй.");
       }
       if (paymentRequestId) {
         // Booking lock serializes retries; the audit and payment commit atomically.
         const [previous] = await tx.select({ details: auditLogs.details }).from(auditLogs).where(and(
           eq(auditLogs.entityType, "booking"), eq(auditLogs.entityId, bookingId),
           eq(auditLogs.action, "booking.payment_updated"),
           sql`${auditLogs.details}->>'paymentRequestId' = ${paymentRequestId}`,
         )).limit(1);
         if (previous) {
           const details = previous.details as { paymentAmount?: number };
           if (details.paymentAmount !== body.paymentAmount) throw new PaymentConflictError("Энэ хүсэлтийн дугаар өөр төлбөрт ашиглагдсан байна.");
           return [current];
         }
       }
       values.finalPaid = paymentFinalPaid(current, body.finalPaid, body.paymentAmount);
       // Preserve the existing combined payment/status intent, not a global status rule.
       if (body.completePayment) values.status = "Дууссан";
     }
     const nextBranch=typeof values.branch === "string" ? values.branch : current.branch;
     const nextDate=typeof values.bookingDate === "string" ? values.bookingDate : current.bookingDate;
     const changingSlot=nextBranch!==current.branch||nextDate!==current.bookingDate;
     const currentCancelled=current.status==="Цуцлагдсан"||current.status==="cancelled";
    const nextStatus=typeof values.status === "string" ? values.status : current.status;
    const nextCancelled=nextStatus==="Цуцлагдсан"||nextStatus==="cancelled";
    let capacitySlot = current.capacitySlot;
    if (!nextCancelled && (currentCancelled || changingSlot || current.capacitySlot === null)) {
     capacitySlot = await findAvailableCapacitySlot(tx, nextBranch, nextDate);
     if (capacitySlot === null) throw new Error(BOOKING_CAPACITY_ERROR);
    }
     const nextValues=nextCancelled
      ? {...values,capacitySlot:null}
      : currentCancelled||changingSlot||current.capacitySlot===null
       ? {...values,capacitySlot}
       : {...values,capacitySlot:current.capacitySlot};
    const [updated] = await tx.update(bookings).set(nextValues).where(eq(bookings.id,bookingId)).returning();
    const changes = createChangeSet(current, updated, ["branch", "bookingDate", "bookingTime", "finalPaid", "status", "advanceType", "advanceNote", "manufactureYear"]);
    const changedFields = Object.keys(changes);
    if (changedFields.length) {
      const isPayment = "finalPaid" in changes;
      const isRescheduled = ["branch", "bookingDate", "bookingTime"].some((field) => field in changes);
      const isCancelled = "status" in changes && (updated.status === "Цуцлагдсан" || updated.status === "cancelled");
      const auditChanges = "manufactureYear" in changes
        ? { ...changes, manufacture_year: changes.manufactureYear }
        : changes;
      if ("manufactureYear" in auditChanges) delete auditChanges.manufactureYear;
      const details = isRescheduled
        ? {
            booking_no: current.bookingNo,
            plate: current.plate,
            customer: current.customer,
            vehicle: current.vehicle,
            manufacture_year: current.manufactureYear,
            branch: { from: current.branch, to: updated.branch },
            booking_date: { from: current.bookingDate, to: updated.bookingDate },
            booking_time: { from: current.bookingTime, to: updated.bookingTime },
          }
        : { booking_no: current.bookingNo, plate: current.plate, customer: current.customer, vehicle: current.vehicle, manufacture_year: current.manufactureYear, ...auditChanges,
            ...(paymentRequestId ? { paymentRequestId, paymentAmount: body.paymentAmount } : {}) };
      await writeAuditLog({
        db: tx, actor: auth.user,
        action: isCancelled ? "booking.cancelled" : isPayment ? "booking.payment_updated" : isRescheduled ? "booking.rescheduled" : "booking.updated",
        entityType: "booking", entityId: updated.id, entityRef: updated.bookingNo, details,
      });
    }
    return [updated];
    });
  if(!row)return Response.json({error:"Захиалга олдсонгүй."},{status:404});
  return Response.json({booking:{...row,date:row.bookingDate,time:row.bookingTime}});
 }catch(error){if(error instanceof PaymentConflictError)return Response.json({error:error.message},{status:409});if(error instanceof Error&&error.message==="RETURNED_BOOKING")return returnedBookingConflict();const invalidInput=inputErrorResponse(error);if(invalidInput)return invalidInput;const manufactureYearError=manufactureYearDatabaseError(error);if(manufactureYearError)return Response.json({error:manufactureYearError},{status:400});if(isDatabaseConnectionError(error))return databaseErrorResponse(error,"Шинэчлэх боломжгүй.");const message=error instanceof Error?error.message:"Шинэчлэх боломжгүй.";if(message===BOOKING_CAPACITY_ERROR)return Response.json({error:message},{status:409});if(message.includes("booking_plate_slot_unique")||message.includes("UNIQUE constraint failed"))return Response.json({error:"Сонгосон цагт энэ улсын дугаартай захиалга байна."},{status:409});return safeErrorResponse(error,"Шинэчлэх боломжгүй.")}
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  const rejectedOrigin = checkRequestOrigin(_request);
  if (rejectedOrigin) return rejectedOrigin;
 try {
  const auth=await requireRole(["admin","operator"]);if("response" in auth)return auth.response;
  const id=validId((await params).id);if(!Number.isInteger(id))return Response.json({error:"Захиалгын дугаар буруу байна."},{status:400});
  const db = await getHealthyDb();
  const [row]=await db.transaction(async (tx) => {
    const [current] = await tx.select().from(bookings).where(eq(bookings.id, id)).limit(1).for("update");
    if (!current) return [];
    if (hasBookingDeleteEvidence(current) || await isReturnedBooking(tx, id)) throw new Error("BOOKING_DELETE_PROTECTED");
    // Read the 0015 fields through JSONB so this guard also works if the flag is
    // OFF or an older schema has no such columns yet.
    const [lineage] = await tx.execute(sql<{ retained: boolean }>`
      select ((to_jsonb(b)->>'returned_to_preorder_at') is not null
        or exists (select 1 from public.pre_bookings p
          where (to_jsonb(p)->>'returned_from_booking_id')::integer = ${id})) as retained
      from public.bookings b where b.id = ${id}`);
    if (!lineage || lineage.retained) throw new Error("BOOKING_DELETE_PROTECTED");
    const [linked] = await tx.select({ id: preBookings.id }).from(preBookings).where(eq(preBookings.convertedBookingId, id)).limit(1);
    if (linked) throw new Error("BOOKING_DELETE_PROTECTED");
    const [visit] = await tx.select({ id: serviceVisits.id }).from(serviceVisits)
      .where(or(eq(serviceVisits.bookingId, id), eq(serviceVisits.bookingNo, current.bookingNo))).limit(1);
    if (visit) throw new Error("BOOKING_DELETE_PROTECTED");
    const [note] = await tx.select({ id: bookingNotes.id }).from(bookingNotes).where(notesCondition("bookings", id)).limit(1);
    if (note) throw new Error("BOOKING_DELETE_PROTECTED");
    // The creation event is expected for a new booking. Any later booking event,
    // including an unfamiliar action, is operational history and blocks deletion.
    const [history] = await tx.select({ id: auditLogs.id }).from(auditLogs)
      .where(and(or(and(eq(auditLogs.entityType, "booking"),
          or(eq(auditLogs.entityId, id), eq(auditLogs.entityRef, current.bookingNo))),
        sql`${auditLogs.details}->>'booking_no' = ${current.bookingNo}`),
        ne(auditLogs.action, "booking.created"))).limit(1);
    if (history) throw new Error("BOOKING_DELETE_PROTECTED");
    const [deleted] = await tx.delete(bookings).where(eq(bookings.id,id)).returning();
    await writeAuditLog({
      db: tx,
      actor: auth.user,
      action: "booking.deleted",
      entityType: "booking",
      entityId: deleted.id,
      entityRef: deleted.bookingNo,
      details: {
        booking_no: current.bookingNo,
        customer: current.customer,
        phone: current.phone,
        plate: current.plate,
        vehicle: current.vehicle,
        product_name: current.productName,
        branch: current.branch,
        booking_date: current.bookingDate,
        booking_time: current.bookingTime,
        total_price: current.totalPrice,
        advance: current.advance,
        final_paid: current.finalPaid,
        manufacture_year: current.manufactureYear,
        status: current.status,
      },
    });
    return [deleted];
  });
  return row?Response.json({deleted:true}):Response.json({error:"Захиалга олдсонгүй."},{status:404});
 } catch (error) {
    if (error instanceof Error && error.message === "BOOKING_DELETE_PROTECTED") return Response.json({ error: protectedBookingMessage }, { status: 409 });
    const invalidInput = inputErrorResponse(error); if (invalidInput) return invalidInput;
  const manufactureYearError = manufactureYearDatabaseError(error);
  if (manufactureYearError) return Response.json({ error: manufactureYearError }, { status: 400 });
  if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Устгах боломжгүй.");
  return safeErrorResponse(error, "Устгах боломжгүй.");
 }
}
