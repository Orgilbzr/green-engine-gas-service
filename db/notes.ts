import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { getHealthyDb } from ".";
import { bookingNotes, preBookings } from "./schema";
import { writeAuditLog } from "../app/audit";
import type { getAppUser } from "../app/authz";

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
  const owner = kind === "bookings" ? sql<number>`coalesce(${bookingNotes.bookingId}, ${preBookings.convertedBookingId})` : sql<number>`${bookingNotes.preBookingId}`;
  const summaries = await db.select({ id: owner, noteCount: sql<number>`count(*)::int`, latestNote: sql<string>`(array_agg(${bookingNotes.note} order by ${bookingNotes.createdAt} desc, ${bookingNotes.id} desc))[1]` })
    .from(bookingNotes).leftJoin(preBookings, eq(bookingNotes.preBookingId, preBookings.id)).where(inArray(owner, rows.map(row => row.id))).groupBy(owner);
  const byId = new Map(summaries.map(row => [row.id, row]));
  return rows.map(row => ({ ...row, noteCount: byId.get(row.id)?.noteCount ?? 0, latestNote: byId.get(row.id)?.latestNote ?? null }));
}
