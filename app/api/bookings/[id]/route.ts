import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { bookings } from "../../../../db/schema";
import { requireRole } from "../../../authz";
import { assertBookingCapacity, BOOKING_CAPACITY_ERROR } from "../../../../db/booking-capacity";

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
  if(typeof body.status==="string")values.status=body.status;
  if(typeof body.advanceType === "string") values.advanceType = ["software", "device", "other"].includes(body.advanceType) ? body.advanceType : null;
  if(typeof body.advanceNote === "string") values.advanceNote = body.advanceNote.trim().slice(0, 200);
    const [row]=await getDb().transaction(async (tx) => {
     const [current]=await tx.select().from(bookings).where(eq(bookings.id,bookingId)).limit(1);
     if(!current)return [];
     const nextBranch=typeof values.branch === "string" ? values.branch : current.branch;
     const nextDate=typeof values.bookingDate === "string" ? values.bookingDate : current.bookingDate;
     const changingSlot=nextBranch!==current.branch||nextDate!==current.bookingDate;
    const currentCancelled=current.status==="Цуцлагдсан"||current.status==="cancelled";
    const nextCancelled=values.status==="Цуцлагдсан"||values.status==="cancelled";
    const becomingActive=currentCancelled&&values.status!==undefined&&!nextCancelled;
    if((changingSlot&&!currentCancelled)||becomingActive)await assertBookingCapacity(tx,nextBranch,nextDate,bookingId);
     return tx.update(bookings).set(values).where(eq(bookings.id,bookingId)).returning();
    });
  if(!row)return Response.json({error:"Захиалга олдсонгүй."},{status:404});
  return Response.json({booking:{...row,date:row.bookingDate,time:row.bookingTime}});
 }catch(error){const message=error instanceof Error?error.message:"Шинэчлэх боломжгүй.";if(message===BOOKING_CAPACITY_ERROR)return Response.json({error:message},{status:409});if(message.includes("UNIQUE constraint failed"))return Response.json({error:"Сонгосон цагт энэ улсын дугаартай захиалга байна."},{status:409});return Response.json({error:message},{status:500})}
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireRole(["admin","operator"]);if("response" in auth)return auth.response;
 const id=Number((await params).id);if(!Number.isInteger(id))return Response.json({error:"Захиалгын дугаар буруу байна."},{status:400});
 const [row]=await getDb().delete(bookings).where(eq(bookings.id,id)).returning();
 return row?Response.json({deleted:true}):Response.json({error:"Захиалга олдсонгүй."},{status:404});
}
