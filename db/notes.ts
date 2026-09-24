import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { getHealthyDb } from ".";
import { bookingNotes, preBookings } from "./schema";
import { writeAuditLog } from "../app/audit";
import type { getAppUser } from "../app/authz";
import { operations0015Enabled } from "../app/operations-0015";

type Database = Awaited<ReturnType<typeof getHealthyDb>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type NotesDb = Database | Transaction;
export function notesCondition(kind: "bookings" | "preorders", id: number) {
  // Preorder records never move: conversion atomically commits this existing link.
  const bookingId = sql`(select converted_booking_id from pre_bookings where id = ${id})`;
  return kind === "bookings"
    ? or(eq(bookingNotes.bookingId, id), inArray(bookingNotes.preBookingId, sql`(select id from pre_bookings where converted_booking_id = ${id})`))!
    : or(eq(bookingNotes.preBookingId, id), eq(bookingNotes.bookingId, bookingId))!;
}
export async function readNotes(db: NotesDb, kind: "bookings" | "preorders", id: number) {
  if (await operations0015Enabled()) {
    const roots = kind === "bookings"
      ? sql`select p.id from public.pre_bookings p where p.converted_booking_id = ${id}`
      : sql`select ${id}::integer`;
    const directBooking = kind === "bookings" ? sql`or n.booking_id = ${id}` : sql``;
    return db.execute(sql`
      with recursive chain(id) as (
        ${roots}
        union all select p.parent_pre_booking_id from public.pre_bookings p
          join chain c on p.id = c.id where p.parent_pre_booking_id is not null
      ), owners as (
        select id as pre_id, null::integer as booking_id from chain
        union select null::integer, p.converted_booking_id from chain c
          join public.pre_bookings p on p.id = c.id where p.converted_booking_id is not null
        union select null::integer, p.returned_from_booking_id from chain c
          join public.pre_bookings p on p.id = c.id where p.returned_from_booking_id is not null
      )
      select distinct n.id, n.note, n.created_at as "createdAt", n.created_by as "createdBy", n.legacy
      from public.booking_notes n
      where n.deleted_at is null and (
        n.pre_booking_id in (select pre_id from owners where pre_id is not null)
        or n.booking_id in (select booking_id from owners where booking_id is not null)
        ${directBooking})
      order by n.created_at desc, n.id desc`);
  }
  return db.select().from(bookingNotes).where(notesCondition(kind, id)).orderBy(desc(bookingNotes.createdAt), desc(bookingNotes.id));
}
export async function appendNote(db: NotesDb, kind: "bookings" | "preorders", id: number, note: string, actor: Awaited<ReturnType<typeof getAppUser>>, ref: string) {
  const [row] = await db.insert(bookingNotes).values({
    bookingId: kind === "bookings" ? id : null, preBookingId: kind === "preorders" ? id : null,
    note, createdBy: actor ? { id: actor.id, name: actor.name || actor.email, role: actor.role } : { id: null, name: "Хэрэглэгч · цахим хүсэлт", role: "public" },
  }).returning();
  await writeAuditLog({ db, actor, action: kind === "bookings" ? "booking.note.added" : "preorder.note.added", entityType: kind === "bookings" ? "booking" : "preorder", entityId: id, entityRef: ref,
    details: { note_id: row.id, created_at: row.createdAt, actor_display_name: row.createdBy.name } });
  return row;
}
// One aggregate query for the whole list; never load every note body into list responses.
export async function withNoteSummaries<T extends { id: number }>(db: NotesDb, kind: "bookings" | "preorders", rows: T[]) {
  if (!rows.length) return [];
  if (await operations0015Enabled()) {
    const ids = sql.join(rows.map(row => sql`${row.id}`), sql`, `);
    const roots = kind === "bookings"
      ? sql`select p.converted_booking_id as target_id, p.id as pre_id from public.pre_bookings p where p.converted_booking_id in (${ids})`
      : sql`select p.id as target_id, p.id as pre_id from public.pre_bookings p where p.id in (${ids})`;
    const direct = kind === "bookings" ? sql`
      select n.booking_id as target_id, n.id as note_id, n.note, n.created_at
      from public.booking_notes n where n.booking_id in (${ids}) and n.deleted_at is null
      union` : sql``;
    const summaries = await db.execute(sql<{ target_id: number; note_count: number; latest_note: string }>`
      with recursive chain(target_id,pre_id) as (
        ${roots}
        union all select c.target_id,p.parent_pre_booking_id from chain c
          join public.pre_bookings p on p.id=c.pre_id where p.parent_pre_booking_id is not null
      ), matched as (
        ${direct}
        select c.target_id,n.id as note_id,n.note,n.created_at from chain c
          join public.booking_notes n on n.pre_booking_id=c.pre_id where n.deleted_at is null
        union
        select c.target_id,n.id as note_id,n.note,n.created_at from chain c
          join public.pre_bookings p on p.id=c.pre_id
          join public.booking_notes n on n.booking_id in (p.converted_booking_id,p.returned_from_booking_id)
          where n.deleted_at is null
      )
      select target_id,count(*)::integer as note_count,
        (array_agg(note order by created_at desc,note_id desc))[1] as latest_note
      from matched group by target_id`);
    const byId = new Map(summaries.map(row => [row.target_id, row]));
    return rows.map(row => ({ ...row, noteCount: byId.get(row.id)?.note_count ?? 0, latestNote: byId.get(row.id)?.latest_note ?? null }));
  }
  const owner = kind === "bookings" ? sql<number>`coalesce(${bookingNotes.bookingId}, ${preBookings.convertedBookingId})` : sql<number>`${bookingNotes.preBookingId}`;
  const summaries = await db.select({ id: owner, noteCount: sql<number>`count(*)::int`, latestNote: sql<string>`(array_agg(${bookingNotes.note} order by ${bookingNotes.createdAt} desc, ${bookingNotes.id} desc))[1]` })
    .from(bookingNotes).leftJoin(preBookings, eq(bookingNotes.preBookingId, preBookings.id)).where(inArray(owner, rows.map(row => row.id))).groupBy(owner);
  const byId = new Map(summaries.map(row => [row.id, row]));
  return rows.map(row => ({ ...row, noteCount: byId.get(row.id)?.noteCount ?? 0, latestNote: byId.get(row.id)?.latestNote ?? null }));
}
