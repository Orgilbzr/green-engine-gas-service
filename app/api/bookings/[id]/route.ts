import { eq } from "drizzle-orm";
import { databaseErrorResponse, getDb, isDatabaseConnectionError, safeErrorResponse } from "../../../../db";
import { bookings } from "../../../../db/schema";
import { requireRole } from "../../../authz";
import { createChangeSet, writeAuditLog } from "../../../audit";
import { BOOKING_CAPACITY_ERROR, withBookingCapacity } from "../../../../db/booking-capacity";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const auth=await requireRole(["admin","operator"]);if("response" in auth)return auth.response;
  const {id}=await params; const bookingId=Number(id); const body=await request.json() as Record<string,unknown>;
  if(!Number.isInteger(bookingId))return Response.json({error:"Захиалгын дугаар буруу байна."},{status:400});
  const values:Record<string,unknown>={};
  if(typeof body.branch==="string")values.branch=body.branch;
  if(typeof body.date==="string")values.bookingDate=body.date;
  if(typeof body.time==="string")values.bookingTime=body.time;
  if(body.finalPaid!==undefined)values.finalPaid=Math.max(0,Number(body.finalPaid)||0);
  if(body.manufactureYear !== undefined) {
   const manufactureYear = body.manufactureYear === "" || body.manufactureYear === null ? null : Number(body.manufactureYear);
   const currentYear = new Date().getFullYear();
   if (manufactureYear !== null && (!Number.isInteger(manufactureYear) || manufactureYear < 1950 || manufactureYear > currentYear + 1)) return Response.json({error:`Үйлдвэрлэсэн он 1950-${currentYear + 1} хооронд бүхэл тоо байна.`},{status:400});
   values.manufactureYear = manufactureYear;
  }
  if(typeof body.status==="string")values.status=body.status;
  if(typeof body.advanceType === "string") values.advanceType = ["software", "device", "other"].includes(body.advanceType) ? body.advanceType : null;
  if(typeof body.advanceNote === "string") values.advanceNote = body.advanceNote.trim().slice(0, 200);
    const [row]=await withBookingCapacity(getDb(), async (tx, capacitySlot) => {
     const [current]=await tx.select().from(bookings).where(eq(bookings.id,bookingId)).limit(1);
     if(!current)return [];
     const nextBranch=typeof values.branch === "string" ? values.branch : current.branch;
     const nextDate=typeof values.bookingDate === "string" ? values.bookingDate : current.bookingDate;
     const changingSlot=nextBranch!==current.branch||nextDate!==current.bookingDate;
     const currentCancelled=current.status==="Цуцлагдсан"||current.status==="cancelled";
    const nextStatus=typeof values.status === "string" ? values.status : current.status;
    const nextCancelled=nextStatus==="Цуцлагдсан"||nextStatus==="cancelled";
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
        : { booking_no: current.bookingNo, plate: current.plate, customer: current.customer, vehicle: current.vehicle, manufacture_year: current.manufactureYear, ...auditChanges };
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
 }catch(error){if(isDatabaseConnectionError(error))return databaseErrorResponse(error,"Шинэчлэх боломжгүй.");const message=error instanceof Error?error.message:"Шинэчлэх боломжгүй.";if(message===BOOKING_CAPACITY_ERROR)return Response.json({error:message},{status:409});if(message.includes("booking_plate_slot_unique")||message.includes("UNIQUE constraint failed"))return Response.json({error:"Сонгосон цагт энэ улсын дугаартай захиалга байна."},{status:409});return safeErrorResponse(error,"Шинэчлэх боломжгүй.")}
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
 try {
  const auth=await requireRole(["admin","operator"]);if("response" in auth)return auth.response;
  const id=Number((await params).id);if(!Number.isInteger(id))return Response.json({error:"Захиалгын дугаар буруу байна."},{status:400});
  const [row]=await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!current) return [];
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
  if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Устгах боломжгүй.");
  return safeErrorResponse(error, "Устгах боломжгүй.");
 }
}
