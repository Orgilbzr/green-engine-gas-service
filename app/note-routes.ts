import { eq, sql } from "drizzle-orm";
import { getHealthyDb, NO_STORE_HEADERS, safeErrorResponse } from "../db";
import { bookings, preBookings } from "../db/schema";
import { appendNote, readNotes } from "../db/notes";
import { requireRole } from "./authz";
import { inputErrorResponse, readJsonObject, validId, text } from "./input-validation";
import { checkRequestOrigin } from "./request-origin";
import { operations0015Enabled, operationsUnavailable } from "./operations-0015";

type Context = { params: Promise<{ id: string }> };
export function noteRoutes(kind: "bookings" | "preorders") {
  async function handle(request: Request, { params }: Context, write: boolean) {
    if (write) { const rejected = checkRequestOrigin(request); if (rejected) return rejected; }
    try {
      const auth = await requireRole(!write && kind === "bookings" ? ["admin", "operator", "mechanic"] : ["admin", "operator"]);
      if ("response" in auth) return auth.response;
      const id = validId((await params).id);
      let note = "";
      if (write) {
        const body = await readJsonObject(request);
        note = text(body.note, 2000, "Тэмдэглэл", true);
      }
      const db = await getHealthyDb();
      return await db.transaction(async tx => {
        const table = kind === "bookings" ? bookings : preBookings;
        const [owner] = await tx.select({ id: table.id, ref: kind === "bookings" ? bookings.bookingNo : sql<string>`'PRE-' || ${preBookings.id}` }).from(table).where(eq(table.id, id)).limit(1);
        if (!owner) return Response.json({ error: "Захиалга олдсонгүй." }, { status: 404 });
        if (write) await appendNote(tx, kind, id, note, auth.user, owner.ref);
        return Response.json({ notes: await readNotes(tx, kind, id) }, { status: write ? 201 : 200, headers: NO_STORE_HEADERS });
      });
    } catch (error) {
      const invalid = inputErrorResponse(error); if (invalid) return invalid;
      return safeErrorResponse(error, "Тэмдэглэлийн түүхийг ачаалах / хадгалах боломжгүй.");
    }
  }
  async function remove(request: Request, { params }: Context) {
    const rejected = checkRequestOrigin(request); if (rejected) return rejected;
    try {
      const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
      if (!(await operations0015Enabled())) return operationsUnavailable();
      const id = validId((await params).id);
      const body = await readJsonObject(request);
      const noteId = validId(body.noteId);
      const db = await getHealthyDb();
      return await db.transaction(async tx => {
        const table = kind === "bookings" ? bookings : preBookings;
        const [owner] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
        if (!owner) return Response.json({ error: "Захиалга олдсонгүй." }, { status: 404 });
        const notes = await readNotes(tx, kind, id);
        if (!notes.some(row => Number(row.id) === noteId)) return Response.json({ error: "Тэмдэглэл олдсонгүй." }, { status: 404 });
        const actor = { id: auth.user.id, email: auth.user.email, name: auth.user.name || auth.user.email, role: auth.user.role };
        const changed = await tx.execute(sql`update public.booking_notes set
          deleted_at = statement_timestamp(), deleted_by = ${JSON.stringify(actor)}::jsonb
          where id = ${noteId} and deleted_at is null returning id`);
        if (!changed.length) return Response.json({ error: "Тэмдэглэл аль хэдийн устсан байна." }, { status: 409 });
        return Response.json({ notes: await readNotes(tx, kind, id) }, { headers: NO_STORE_HEADERS });
      });
    } catch (error) {
      return inputErrorResponse(error) ?? safeErrorResponse(error, "Тэмдэглэл устгах боломжгүй.");
    }
  }
  return { GET: (request: Request, context: Context) => handle(request, context, false), POST: (request: Request, context: Context) => handle(request, context, true), DELETE: remove };
}
