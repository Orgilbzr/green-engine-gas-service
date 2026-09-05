import { asc, eq } from "drizzle-orm";
import { requireRole, ADMIN_EMAIL, type Role } from "../../authz";
import { createRequestDiagnostics, getHealthyDb, safeErrorResponse } from "../../../db";
import { appUsers } from "../../../db/schema";
import { hashPassword } from "../../email-auth";
import { writeAuditLog } from "../../audit";

const roles: Role[] = ["admin", "operator", "mechanic"];

export async function GET() {
  const diagnostics = createRequestDiagnostics("GET /api/users");
  diagnostics.stage("route_start");
  try {
    const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
    diagnostics.stage("db_query_start");
    const rows = await (await getHealthyDb()).select().from(appUsers).orderBy(asc(appUsers.email));
    diagnostics.stage("db_query_complete");
    diagnostics.stage("response");
    return Response.json({ users: [{ id: 0, email: ADMIN_EMAIL, role: "admin", active: true, protected: true }, ...rows.map(publicUser)] });
  } catch (error) {
    diagnostics.stage("response");
    return safeErrorResponse(error, "Хэрэглэгчийн мэдээллийг ачаалж чадсангүй.");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const body = await request.json() as { email?: string; password?: string; role?: Role };
  const email = String(body.email || "").trim().toLowerCase();
  if (!email.includes("@") || !body.password || body.password.length < 8 || !roles.includes(body.role as Role)) return Response.json({ error: "Имэйл, password эсвэл эрх буруу байна." }, { status: 400 });
  if (email === ADMIN_EMAIL) return Response.json({ error: "Үндсэн админы эрхийг өөрчлөхгүй." }, { status: 400 });
  const db = await getHealthyDb();
  const existing = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
  const [row] = existing.length
    ? await db.update(appUsers).set({ passwordHash: await hashPassword(body.password), role: body.role!, active: true }).where(eq(appUsers.email, email)).returning()
    : await db.insert(appUsers).values({ email, passwordHash: await hashPassword(body.password), role: body.role!, active: true }).returning();
  await writeAuditLog({ db, action: existing.length ? "user.updated" : "user.created", entityType: "user", entityId: row.id, entityRef: row.email, details: { email: row.email, role: row.role, active: row.active } });
  return Response.json({ user: publicUser(row) }, { status: 201 });
}

function publicUser(user: typeof appUsers.$inferSelect) {
  const { passwordHash: _passwordHash, ...visible } = user;
  return visible;
}
