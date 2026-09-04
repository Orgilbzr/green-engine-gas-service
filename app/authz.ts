import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appUsers } from "../db/schema";
import { getEmailUser } from "./email-auth";

export type Role = "admin" | "operator" | "mechanic";
export const ADMIN_EMAIL = "orgil.bzr@gmail.com";

export async function getAppUser() {
  const identity = await getEmailUser();
  if (!identity) return null;
  const email = identity.email.trim().toLowerCase();
  if (email === ADMIN_EMAIL) return { id: null, email, name: identity.displayName, role: "admin" as Role, active: true };
  const [row] = await getDb().select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
  if (!row || !row.active) return null;
  return { id: row.id, email, name: identity.displayName, role: row.role as Role, active: row.active };
}

export async function requireRole(roles: Role[]) {
  const user = await getAppUser();
  if (!user) return { response: Response.json({ error: "Энэ системд нэвтрэх эрхгүй байна." }, { status: 403 }) };
  if (!roles.includes(user.role)) return { response: Response.json({ error: "Энэ үйлдлийг хийх эрхгүй байна." }, { status: 403 }) };
  return { user };
}

export function bookingForRole<T extends Record<string, unknown>>(booking: T, role: Role) {
  if (role !== "mechanic") return booking;
  const { totalPrice: _totalPrice, advance: _advance, finalPaid: _finalPaid, receipt: _receipt, ...visible } = booking;
  return { ...visible, advancePaid: Number(booking.advance) > 0, balancePaid: Number(booking.finalPaid) > 0 || Number(booking.totalPrice) - Number(booking.advance) <= 0 };
}
