import { and, desc, eq } from "drizzle-orm";
import { getHealthyDb, safeErrorResponse, NO_STORE_HEADERS } from "../../../../../db";
import { bookings, serviceVisits } from "../../../../../db/schema";
import { bookingForRole, requireRole } from "../../../../authz";
import { writeAuditLog } from "../../../../audit";
import { checkRequestOrigin } from "../../../../request-origin";
import { BRANCHES, InputError, enumValue, inputErrorResponse, readJsonObject, text, validDate, validId, validTime } from "../../../../input-validation";
import { processSteps, purposeLabels, type ProcessStep } from "../../../../service-process";
import { isReturnedBooking, returnedBookingConflict } from "../../../../operations-0015";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await requireRole(["admin", "operator", "mechanic"]); if ("response" in auth) return auth.response;
    const id = validId((await params).id);
    const db = await getHealthyDb();
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!booking) return Response.json({ error: "Захиалга олдсонгүй." }, { status: 404 });
    const visits = await db.select().from(serviceVisits).where(eq(serviceVisits.bookingId, id)).orderBy(desc(serviceVisits.visitedAt), desc(serviceVisits.id));
    return Response.json({ booking: bookingForRole({ ...booking, date: booking.bookingDate, time: booking.bookingTime }, auth.user.role), visits }, { headers: NO_STORE_HEADERS });
  } catch (error) { return inputErrorResponse(error) ?? safeErrorResponse(error, "Явцыг унших боломжгүй."); }
}
export async function PATCH(request: Request, { params }: Context) {
  const rejected = checkRequestOrigin(request); if (rejected) return rejected;
  try {
    const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
    const id = validId((await params).id), body = await readJsonObject(request);
    const action = enumValue(body.action, ["step", "visit.add", "visit.edit", "visit.delete"], "Үйлдэл");
    const actor = { id: auth.user.id, name: auth.user.name || auth.user.email, role: auth.user.role };
    const db = await getHealthyDb();
    return await db.transaction(async tx => {
      const [current] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
      if (!current) return Response.json({ error: "Захиалга олдсонгүй." }, { status: 404 });
      if (await isReturnedBooking(tx, id)) return returnedBookingConflict();
      const audit = async (event: string, before: unknown, after: unknown) => writeAuditLog({ db: tx, actor: auth.user, action: event, entityType: "booking", entityId: id, entityRef: current.bookingNo, details: { actor_display_name: actor.name, booking_no: current.bookingNo, plate: current.plate, change: JSON.parse(JSON.stringify({ from: before, to: after })) } });
      if (action === "step") {
        const step = enumValue(body.step, processSteps, "Явц") as ProcessStep;
        if (typeof body.completed !== "boolean") throw new InputError("Төлөв boolean байх ёстой.");
        const key = `${step}Completed` as const;
        if (current[key] !== body.completed) {
          const incompleteHandover = step === "handover" && body.completed && (!current.programmingCompleted || !current.installationCompleted);
          const undoDuringHandover = step !== "handover" && !body.completed && current.handoverCompleted;
          if ((incompleteHandover || undoDuringHandover) && body.confirmIncomplete !== true) return Response.json({ error: "Программ эсвэл суурилуулалт дуусаагүй байна. Хүлээлгэн өгсөн төлөвтэй үргэлжлүүлэх үү?", requiresConfirmation: true }, { status: 409 });
          const values = { [key]: body.completed, [`${step}CompletedAt`]: body.completed ? new Date() : null, [`${step}CompletedBy`]: body.completed ? actor : null };
          await tx.update(bookings).set(values).where(eq(bookings.id, id));
          await audit(`booking.${step}.${body.completed ? "completed" : "reverted"}`, { completed: current[key], at: current[`${step}CompletedAt`], by: current[`${step}CompletedBy`] }, { ...values, incompleteAcknowledged: incompleteHandover || undoDuringHandover });
        }
      } else {
        const visitId = action !== "visit.add" ? validId(body.visitId) : null;
        const [before] = visitId ? await tx.select().from(serviceVisits).where(and(eq(serviceVisits.id, visitId), eq(serviceVisits.bookingId, id))) : [];
        if (visitId && !before) return Response.json({ error: "Ирэлт олдсонгүй." }, { status: 404 });
        if (action === "visit.delete") {
          await tx.delete(serviceVisits).where(eq(serviceVisits.id, visitId!));
          await audit("booking.visit.deleted", before, null);
        } else {
          const values = { visitedAt: new Date(`${validDate(body.date)}T${validTime(body.time)}:00+08:00`), purpose: enumValue(body.purpose, Object.keys(purposeLabels), "Зорилго"), branch: enumValue(body.branch, BRANCHES, "Салбар"), note: text(body.note ?? "", 500, "Тэмдэглэл") };
          const [after] = before ? await tx.update(serviceVisits).set(values).where(eq(serviceVisits.id, before.id)).returning() : await tx.insert(serviceVisits).values({ ...values, bookingId: id, bookingNo: current.bookingNo, recordedBy: actor }).returning();
          await audit(before ? "booking.visit.updated" : "booking.visit.created", before ?? null, after);
        }
      }
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id));
      const visits = await tx.select().from(serviceVisits).where(eq(serviceVisits.bookingId, id)).orderBy(desc(serviceVisits.visitedAt), desc(serviceVisits.id));
      return Response.json({ booking: { ...booking, date: booking.bookingDate, time: booking.bookingTime }, visits }, { headers: NO_STORE_HEADERS });
    });
  } catch (error) { return inputErrorResponse(error) ?? safeErrorResponse(error, "Явцыг хадгалах боломжгүй."); }
}
