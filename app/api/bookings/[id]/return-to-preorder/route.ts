import { eq, sql } from "drizzle-orm";
import { getHealthyDb, safeErrorResponse } from "../../../../../db";
import { bookings, preBookings, serviceVisits } from "../../../../../db/schema";
import { withNoteSummaries } from "../../../../../db/notes";
import { requireRole } from "../../../../authz";
import { writeAuditLog } from "../../../../audit";
import { returnIneligibleReason } from "../../../../booking-return";
import { validId, inputErrorResponse } from "../../../../input-validation";
import { operations0015Enabled, operationsUnavailable } from "../../../../operations-0015";
import { checkRequestOrigin } from "../../../../request-origin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = checkRequestOrigin(request); if (rejected) return rejected;
  try {
    const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
    if (!(await operations0015Enabled())) return operationsUnavailable();
    const id = validId((await params).id);
    const db = await getHealthyDb();
    const result = await db.transaction(async tx => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
      if (!booking) return { response: Response.json({ error: "Захиалга олдсонгүй." }, { status: 404 }) };
      const marker = await tx.execute(sql<{ returned: Date | null }>`
        select returned_to_preorder_at as returned from public.bookings where id = ${id}`);
      const [visit] = await tx.select({ id: serviceVisits.id }).from(serviceVisits).where(eq(serviceVisits.bookingId, id)).limit(1);
      const reason = returnIneligibleReason(booking, !!visit, marker[0]?.returned != null);
      if (reason) return { response: Response.json({ error: reason }, { status: 409 }) };
      const [original] = await tx.select().from(preBookings).where(eq(preBookings.convertedBookingId, id)).limit(1).for("update");
      const prior = await tx.execute(sql<{ id: number }>`
        select id from public.pre_bookings where returned_from_booking_id = ${id} limit 1`);
      if (prior.length) return { response: Response.json({ error: "Энэ захиалгыг аль хэдийн буцаасан байна." }, { status: 409 }) };
      const manufactureYear = booking.manufactureYear ?? original?.manufactureYear;
      if (manufactureYear == null) return { response: Response.json({ error: "Үйлдвэрлэсэн онгүй түүхэн захиалгыг буцаах боломжгүй." }, { status: 409 }) };
      const inserted = await tx.execute(sql<{ id: number }>`
        insert into public.pre_bookings
          (customer,phone,vehicle,plate,manufacture_year,source,note,status,
           parent_pre_booking_id,returned_from_booking_id)
        values (${booking.customer},${booking.phone},${booking.vehicle},${booking.plate},
          ${manufactureYear},${original?.source ?? "manual"},'', 'new',${original?.id ?? null},${id})
        returning id`);
      const preorderId = Number(inserted[0].id);
      const updated = await tx.execute(sql<{ returnedAt: Date }>`update public.bookings set status = 'cancelled', capacity_slot = null,
        returned_to_preorder_at = statement_timestamp() where id = ${id}
        returning returned_to_preorder_at as "returnedAt"`);
      await writeAuditLog({ db: tx, actor: auth.user, action: "booking.returned_to_preorder",
        entityType: "booking", entityId: id, entityRef: booking.bookingNo,
        details: { booking_id: id, booking_no: booking.bookingNo, previous_branch: booking.branch,
          previous_appointment_date: booking.bookingDate, previous_appointment_time: booking.bookingTime,
          target_preorder_id: preorderId, original_preorder_id: original?.id ?? null,
          actor: { id: auth.user.id, email: auth.user.email, role: auth.user.role },
          returned_at: updated[0].returnedAt } });
      const [preBooking] = await tx.select().from(preBookings).where(eq(preBookings.id, preorderId));
      return { preBooking };
    });
    if ("response" in result) return result.response;
    return Response.json({ preBooking: (await withNoteSummaries(db, "preorders", [result.preBooking]))[0], message: "Урьдчилсан захиалга руу буцаалаа" });
  } catch (error) {
    const invalid = inputErrorResponse(error); if (invalid) return invalid;
    const constraint = (error as { constraint?: string }).constraint;
    if (constraint === "pre_bookings_returned_from_booking_unique") return Response.json({ error: "Энэ захиалгыг аль хэдийн буцаасан байна." }, { status: 409 });
    return safeErrorResponse(error, "Урьдчилсан захиалга руу буцаах боломжгүй.");
  }
}
