import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { appUsers, loginSessions } from "../db/schema";

export type EmailUser = { displayName: string; email: string; fullName: null };
export const SESSION_COOKIE = "gas_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }

export async function loginWithPassword(email: string, password: string, stage?: (name: string) => void) {
  const normalized = normalizeEmail(email);
  let passwordHash: string | null | undefined;
  if (normalized === "orgil.bzr@gmail.com") passwordHash = process.env.ADMIN_PASSWORD_HASH || null;
  else {
    stage?.("authentication_lookup_start");
    const [user] = await getDb().select({ passwordHash: appUsers.passwordHash, active: appUsers.active }).from(appUsers).where(eq(appUsers.email, normalized)).limit(1);
    stage?.("authentication_lookup_complete");
    if (!user?.active) return false;
    passwordHash = user.passwordHash;
  }
  if (normalized === "orgil.bzr@gmail.com" && !passwordHash) {
    if (password !== process.env.ADMIN_PASSWORD) return false;
  } else if (!passwordHash || !(await verifyPassword(password, passwordHash))) return false;
  const token = crypto.randomUUID() + crypto.randomUUID();
  stage?.("session_insert_start");
  await getDb().insert(loginSessions).values({ tokenHash: await hash(token), email: normalized, expiresAt: Date.now() + SESSION_TTL_MS });
  stage?.("session_insert_complete");
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  return true;
}

export async function getEmailUser(stage?: (name: string) => void): Promise<EmailUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  stage?.("session_lookup_start");
  const [session] = await getDb().select().from(loginSessions).where(and(eq(loginSessions.tokenHash, await hash(token)), gt(loginSessions.expiresAt, Date.now()))).limit(1);
  stage?.("session_lookup_complete");
  return session ? { displayName: session.email, email: session.email, fullName: null } : null;
}

export async function clearEmailSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(loginSessions).where(eq(loginSessions.tokenHash, await hash(token)));
  cookieStore.delete(SESSION_COOKIE);
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string) {
  const [saltText, expected] = stored.split(":");
  if (!saltText || !expected) return false;
  const salt = Uint8Array.from(saltText.match(/.{2}/g) || [], value => Number.parseInt(value, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return safeCompare(toHex(new Uint8Array(bits)), expected);
}

function toHex(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function safeCompare(left: string, right: string) { return left.length === right.length && left === right; }