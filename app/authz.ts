import { AuthServiceError, authErrorResponse } from "./auth-errors";
import { eq } from "drizzle-orm";
import { getHealthyDb } from "../db";
import { appUsers } from "../db/schema";
import { getEmailUser } from "./email-auth";
import { ADMIN_EMAIL } from "./admin-identity";

export type Role = "admin" | "operator" | "mechanic";
export { ADMIN_EMAIL } from "./admin-identity";

export async function getAppUser(stage?: (name: string) => void) {
  try {
    const identity = await getEmailUser(stage);
    if (!identity) return null;
    const email = identity.email.trim().toLowerCase();
    if (email === ADMIN_EMAIL) return { id: null, email, name: identity.displayName, role: "admin" as Role, active: true };
    stage?.("user_lookup_start");
    const [row] = await (await getHealthyDb()).select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
    stage?.("user_lookup_complete");
    if (!row || !row.active) return null;
    return { id: row.id, email, name: identity.displayName, role: row.role as Role, active: row.active };
  } catch { throw new AuthServiceError(); }
}

export async function requireRole(roles: Role[]) {
  try {
    const user = await getAppUser();
    if (!user) return { response: Response.json({ error: "Энэ системд нэвтрэх эрхгүй байна." }, { status: 403 }) };
    if (!roles.includes(user.role)) return { response: Response.json({ error: "Энэ үйлдлийг хийх эрхгүй байна." }, { status: 403 }) };
    return { user };
  } catch {
    return { response: authErrorResponse({ route: "authorization", requestId: crypto.randomUUID(), stage: "session_validation" }, "Нэвтрэлтийг шалгах боломжгүй байна.") };
  }
}

export function bookingForRole<T extends Record<string, unknown>>(booking: T, role: Role) {
  if (role !== "mechanic") return booking;
  const { totalPrice: _totalPrice, advance: _advance, finalPaid: _finalPaid, receipt: _receipt, ...visible } = booking;
  return { ...visible, advancePaid: Number(booking.advance) > 0, balancePaid: Number(booking.finalPaid) > 0 || Number(booking.totalPrice) - Number(booking.advance) <= 0 };
}
