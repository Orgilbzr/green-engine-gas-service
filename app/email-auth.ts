import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { getHealthyDb } from "../db";
import { appUsers, loginSessions } from "../db/schema";
import { ADMIN_EMAIL } from "./admin-identity";
import { AuthServiceError } from "./auth-errors";

export type EmailUser = { displayName: string; email: string; fullName: null };
export const SESSION_COOKIE = "gas_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Preserve the existing 16-byte salt / 32-byte digest format and 120,000-iteration derivation.
const PASSWORD_HASH_PATTERN = /^[a-f0-9]{32}:[a-f0-9]{64}$/;
const RANDOM_TOKEN_PATTERN = /^[a-f0-9-]{72}$/;

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
function adminPasswordHash() {
  const value = process.env.ADMIN_PASSWORD_HASH;
  return value && PASSWORD_HASH_PATTERN.test(value) ? value : null;
}
function adminSignature(randomToken: string, credential: string) {
  return createHmac("sha256", credential).update(`green-engine:admin-session:v1:${randomToken}`).digest();
}
function validAdminToken(token: string, credential: string) {
  const [randomToken, signature, extra] = token.split(".");
  if (extra !== undefined || !RANDOM_TOKEN_PATTERN.test(randomToken) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(adminSignature(randomToken, credential), Buffer.from(signature, "hex"));
}
function validTokenShape(token: string) {
  return RANDOM_TOKEN_PATTERN.test(token) || /^[a-f0-9-]{72}\.[a-f0-9]{64}$/.test(token);
}

export async function loginWithPassword(email: string, password: string, stage?: (name: string) => void) {
  const normalized = normalizeEmail(email);
  const configuredAdminHash = normalized === ADMIN_EMAIL ? adminPasswordHash() : null;
  if (normalized === ADMIN_EMAIL && !configuredAdminHash) return false;
  const cookieStore = await cookies();
  const previousToken = cookieStore.get(SESSION_COOKIE)?.value;
  const db = await getHealthyDb();
  const token = await db.transaction(async tx => {
    let credential: string | null;
    if (normalized === ADMIN_EMAIL) {
      credential = configuredAdminHash;
    } else {
      stage?.("authentication_lookup_start");
      // Serialize staff login with reset/disable: an old-password login cannot insert
      // a session after a concurrent reset has deleted that account's sessions.
      const [user] = await tx.select({ passwordHash: appUsers.passwordHash, active: appUsers.active })
        .from(appUsers).where(eq(appUsers.email, normalized)).limit(1).for("update");
      stage?.("authentication_lookup_complete");
      if (!user?.active) return null;
      credential = user.passwordHash;
    }
    if (!credential || !await verifyPassword(password, credential)) return null;
    const randomToken = crypto.randomUUID() + crypto.randomUUID();
    // The signature makes legacy, removed-credential and rotated-credential admin
    // sessions fail closed without a schema migration. The DB still stores only a digest.
    const nextToken = normalized === ADMIN_EMAIL
      ? `${randomToken}.${adminSignature(randomToken, credential).toString("hex")}` : randomToken;
    stage?.("session_insert_start");
    if (previousToken && validTokenShape(previousToken)) {
      await tx.delete(loginSessions).where(eq(loginSessions.tokenHash, await hash(previousToken)));
    }
    await tx.insert(loginSessions).values({ tokenHash: await hash(nextToken), email: normalized, expiresAt: Date.now() + SESSION_TTL_MS });
    stage?.("session_insert_complete");
    return nextToken;
  });
  if (!token) return false;
  cookieStore.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  return true;
}

export async function getEmailUser(stage?: (name: string) => void): Promise<EmailUser | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !validTokenShape(token)) return null;
    stage?.("session_lookup_start");
    const [session] = await (await getHealthyDb()).select({ email: loginSessions.email }).from(loginSessions)
      .leftJoin(appUsers, eq(appUsers.email, loginSessions.email))
      .where(and(eq(loginSessions.tokenHash, await hash(token)), gt(loginSessions.expiresAt, Date.now()),
        or(eq(loginSessions.email, ADMIN_EMAIL), eq(appUsers.active, true)))).limit(1);
    stage?.("session_lookup_complete");
    if (!session) return null;
    if (session.email === ADMIN_EMAIL) {
      const credential = adminPasswordHash();
      if (!credential || !validAdminToken(token, credential)) return null;
    }
    return { displayName: session.email, email: session.email, fullName: null };
  } catch {
    // Callers outside a route try/catch must not receive a raw query error with session data.
    throw new AuthServiceError();
  }
}

export async function clearEmailSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token && validTokenShape(token)) await (await getHealthyDb()).delete(loginSessions).where(eq(loginSessions.tokenHash, await hash(token)));
  cookieStore.delete(SESSION_COOKIE);
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePassword(password, salt);
  return `${Buffer.from(salt).toString("hex")}:${digest.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  if (!PASSWORD_HASH_PATTERN.test(stored)) return false;
  const [salt, expected] = stored.split(":");
  const actual = await derivePassword(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new Uint8Array(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
  return Buffer.from(bits);
}
