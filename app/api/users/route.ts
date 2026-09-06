import { readValidatedBody, inputErrorResponse, ROLES } from "../../input-validation";
import { checkRequestOrigin } from "../../request-origin";
import { authErrorResponse } from "../../auth-errors";
import { asc, eq } from "drizzle-orm";
import { requireRole, ADMIN_EMAIL, type Role } from "../../authz";
import { createRequestDiagnostics, getHealthyDb } from "../../../db";
import { appUsers, loginSessions } from "../../../db/schema";
import { hashPassword } from "../../email-auth";
import { writeAuditLog } from "../../audit";

const roles: readonly Role[] = ROLES;

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
    const invalidInput = inputErrorResponse(error); if (invalidInput) return invalidInput;
    diagnostics.stage("response");
    return authErrorResponse({ route: "GET /api/users", requestId: diagnostics.requestId, stage: "response" }, "Хэрэглэгчийн мэдээллийг ачаалж чадсангүй.");
  }
}

export async function POST(request: Request) {
  const rejectedOrigin = checkRequestOrigin(request);
  if (rejectedOrigin) return rejectedOrigin;
  const diagnostics = createRequestDiagnostics("POST /api/users");
  try {
    const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
    const body = await readValidatedBody(request, "user");
    const email = String(body.email || "").trim().toLowerCase();
    if (!email.includes("@") || typeof body.password !== "string" || body.password.length < 8 || !roles.includes(body.role as Role)) return Response.json({ error: "Имэйл, password эсвэл эрх буруу байна." }, { status: 400 });
    if (email === ADMIN_EMAIL) return Response.json({ error: "Үндсэн админы эрхийг өөрчлөхгүй." }, { status: 400 });
    const passwordHash = await hashPassword(body.password);
    const db = await getHealthyDb();
    const row = await db.transaction(async tx => {
      // Login takes the same row lock, preventing an old-password session after reset.
      const existing = await tx.select().from(appUsers).where(eq(appUsers.email, email)).limit(1).for("update");
      const [updated] = existing.length
        ? await tx.update(appUsers).set({ passwordHash, role: body.role!, active: true }).where(eq(appUsers.email, email)).returning()
        : await tx.insert(appUsers).values({ email, passwordHash, role: body.role!, active: true }).returning();
      await tx.delete(loginSessions).where(eq(loginSessions.email, email));
      await writeAuditLog({ db: tx, actor: auth.user, action: existing.length ? "user.updated" : "user.created", entityType: "user", entityId: updated.id, entityRef: updated.email, details: { email: updated.email, role: updated.role, active: updated.active } });
      return updated;
    });
    return Response.json({ user: publicUser(row) }, { status: 201 });
  } catch (error) {
    const invalidInput = inputErrorResponse(error); if (invalidInput) return invalidInput;
    return authErrorResponse({ route: "POST /api/users", requestId: diagnostics.requestId, stage: "response" }, "Хэрэглэгчийн мэдээллийг хадгалж чадсангүй.");
  }
}

function publicUser(user: typeof appUsers.$inferSelect) {
  const { passwordHash: _passwordHash, ...visible } = user;
  return visible;
}
