import { asc, eq } from "drizzle-orm";
import { requireRole, ADMIN_EMAIL, type Role } from "../../authz";
import { getDb } from "../../../db";
import { appUsers } from "../../../db/schema";
import { hashPassword } from "../../email-auth";

const roles: Role[] = ["admin", "operator", "mechanic"];

export async function GET() {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const rows = await getDb().select().from(appUsers).orderBy(asc(appUsers.email));
  return Response.json({ users: [{ id: 0, email: ADMIN_EMAIL, role: "admin", active: true, protected: true }, ...rows] });
}

export async function POST(request: Request) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const body = await request.json() as { email?: string; password?: string; role?: Role };
  const email = String(body.email || "").trim().toLowerCase();
  if (!email.includes("@") || !body.password || body.password.length < 8 || !roles.includes(body.role as Role)) return Response.json({ error: "Имэйл, password эсвэл эрх буруу байна." }, { status: 400 });
  if (email === ADMIN_EMAIL) return Response.json({ error: "Үндсэн админы эрхийг өөрчлөхгүй." }, { status: 400 });
  const existing = await getDb().select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
  const [row] = existing.length
    ? await getDb().update(appUsers).set({ passwordHash: await hashPassword(body.password), role: body.role!, active: true }).where(eq(appUsers.email, email)).returning()
    : await getDb().insert(appUsers).values({ email, passwordHash: await hashPassword(body.password), role: body.role!, active: true }).returning();
  return Response.json({ user: row }, { status: 201 });
}
