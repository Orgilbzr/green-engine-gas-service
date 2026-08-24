import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { bookings } from "../../../../db/schema";
import { requireRole } from "../../../authz";

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
  const [row]=await getDb().update(bookings).set(values).where(eq(bookings.id,bookingId)).returning();
  if(!row)return Response.json({error:"Захиалга олдсонгүй."},{status:404});
  return Response.json({booking:{...row,date:row.bookingDate,time:row.bookingTime}});
 }catch(error){const message=error instanceof Error?error.message:"Шинэчлэх боломжгүй.";if(message.includes("UNIQUE constraint failed"))return Response.json({error:"Сонгосон салбар тухайн өдөр захиалгатай байна."},{status:409});return Response.json({error:message},{status:500})}
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireRole(["admin","operator"]);if("response" in auth)return auth.response;
 const id=Number((await params).id);if(!Number.isInteger(id))return Response.json({error:"Захиалгын дугаар буруу байна."},{status:400});
 const [row]=await getDb().delete(bookings).where(eq(bookings.id,id)).returning();
 return row?Response.json({deleted:true}):Response.json({error:"Захиалга олдсонгүй."},{status:404});
}
