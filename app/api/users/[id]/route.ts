import { eq } from "drizzle-orm";
import { requireRole, ADMIN_EMAIL, type Role } from "../../../authz";
import { createRequestDiagnostics, getHealthyDb } from "../../../../db";
import { appUsers, loginSessions } from "../../../../db/schema";
import { createChangeSet, writeAuditLog } from "../../../audit";
import { authErrorResponse } from "../../../auth-errors";

const roles: Role[] = ["admin", "operator", "mechanic"];
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnostics = createRequestDiagnostics("PATCH /api/users/[id]");
  try {
    const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
    const id = Number((await params).id);
    const body = await request.json() as { role?: Role; active?: boolean };
    if (id === 0) return Response.json({ error: "Үндсэн админы эрхийг өөрчлөхгүй." }, { status: 400 });
    const values: { role?: Role; active?: boolean } = {};
    if (body.role && roles.includes(body.role)) values.role = body.role;
    if (typeof body.active === "boolean") values.active = body.active;
    if (!Number.isSafeInteger(id) || id < 1 || !Object.keys(values).length) return Response.json({ error: "Хэрэглэгчийн мэдээлэл буруу байна." }, { status: 400 });
    return await (await getHealthyDb()).transaction(async tx => {
      const [current] = await tx.select().from(appUsers).where(eq(appUsers.id, id)).limit(1).for("update");
      if (!current) return Response.json({ error: "Хэрэглэгч олдсонгүй." }, { status: 404 });
      if (current.email === ADMIN_EMAIL) return Response.json({ error: "Үндсэн админы эрхийг өөрчлөхгүй." }, { status: 400 });
      const [row] = await tx.update(appUsers).set(values).where(eq(appUsers.id, id)).returning();
      // Also discard legacy sessions on reactivation; they must never revive.
      if (values.active === false || (current.active === false && values.active === true)) {
        await tx.delete(loginSessions).where(eq(loginSessions.email, current.email));
      }
      const changes = createChangeSet(current, row, ["role", "active"]);
      if (Object.keys(changes).length) await writeAuditLog({ db: tx, actor: auth.user, action: "role" in changes ? "user.role_changed" : row.active ? "user.activated" : "user.deactivated", entityType: "user", entityId: row.id, entityRef: row.email, details: changes });
      const { passwordHash: _passwordHash, ...visible } = row;
      return Response.json({ user: visible });
    });
  } catch {
    return authErrorResponse({ route: "PATCH /api/users/[id]", requestId: diagnostics.requestId, stage: "response" }, "Хэрэглэгчийн мэдээллийг хадгалж чадсангүй.");
  }
}
