import { eq, sql } from "drizzle-orm";
import { getHealthyDb, NO_STORE_HEADERS, safeErrorResponse } from "../db";
import { bookings, preBookings } from "../db/schema";
import { appendNote, readNotes } from "../db/notes";
import { requireRole } from "./authz";
import { inputErrorResponse, readJsonObject, validId, text } from "./input-validation";
import { checkRequestOrigin } from "./request-origin";
import { operations0015Enabled, operationsUnavailable } from "./operations-0015";
import { RequestTiming, withRequestTiming } from "../db/request-timing";

type Context = { params: Promise<{ id: string }> };
export function noteRoutes(kind: "bookings" | "preorders") {
  async function handle(request: Request, { params }: Context, write: boolean) {
    const timing = !write && kind === "bookings" ? new RequestTiming() : undefined;
    const run = async () => {
      if (write) { const rejected = checkRequestOrigin(request); if (rejected) return rejected; }
      try {
        const roles = !write && kind === "bookings" ? ["admin", "operator", "mechanic"] as const : ["admin", "operator"] as const;
        const auth = timing ? await timing.measure("auth-total", () => requireRole([...roles], timing.authStage)) : await requireRole([...roles]);
        if ("response" in auth) return timing ? timing.finish(auth.response as Response) : auth.response;
        const id = validId((await params).id);
        let note = "";
        if (write) {
          const body = await readJsonObject(request);
          note = text(body.note, 2000, "Тэмдэглэл", true);
        }
        const db = await getHealthyDb();
        const transactionStarted = timing ? performance.now() : 0;
        let callbackDuration = 0;
        let response: Response;
        try {
          response = await db.transaction(async tx => {
            const callbackStarted = timing ? performance.now() : 0;
            try {
              const table = kind === "bookings" ? bookings : preBookings;
              const lookup = () => tx.select({ id: table.id, ref: kind === "bookings" ? bookings.bookingNo : sql<string>`'PRE-' || ${preBookings.id}` }).from(table).where(eq(table.id, id)).limit(1);
              const [owner] = timing ? await timing.measure("booking-existence", async () => await lookup()) : await lookup();
              if (!owner) return Response.json({ error: "Захиалга олдсонгүй." }, { status: 404 });
              if (write) await appendNote(tx, kind, id, note, auth.user, owner.ref);
              const notes = await readNotes(tx, kind, id, timing);
              return timing ? timing.measureSync("response", () => Response.json({ notes }, { status: write ? 201 : 200, headers: NO_STORE_HEADERS }))
                : Response.json({ notes }, { status: write ? 201 : 200, headers: NO_STORE_HEADERS });
            } finally { if (timing) callbackDuration = performance.now() - callbackStarted; }
          });
        } finally { timing?.add("transaction-overhead", performance.now() - transactionStarted - callbackDuration); }
        return timing ? timing.finish(response) : response;
      } catch (error) {
        const response = inputErrorResponse(error) ?? safeErrorResponse(error, "Тэмдэглэлийн түүхийг ачаалах / хадгалах боломжгүй.");
        return timing ? timing.finish(response) : response;
      }
    };
    return timing ? withRequestTiming(timing, run) : run();
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
