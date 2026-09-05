import { eq } from "drizzle-orm";
import { requireRole, type Role } from "../../../authz";
import { getHealthyDb } from "../../../../db";
import { appUsers } from "../../../../db/schema";
import { createChangeSet, writeAuditLog } from "../../../audit";

const roles: Role[] = ["admin", "operator", "mechanic"];
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const id = Number((await params).id); const body = await request.json() as { role?: Role; active?: boolean };
  const values: { role?: Role; active?: boolean } = {};
  if (body.role && roles.includes(body.role)) values.role = body.role;
  if (typeof body.active === "boolean") values.active = body.active;
  const db = await getHealthyDb();
  const [current] = await db.select().from(appUsers).where(eq(appUsers.id, id)).limit(1);
  if (!current) return Response.json({ error: "Хэрэглэгч олдсонгүй." }, { status: 404 });
  const [row] = await db.update(appUsers).set(values).where(eq(appUsers.id, id)).returning();
  const changes = createChangeSet(current, row, ["role", "active"]);
  if (Object.keys(changes).length) await writeAuditLog({ db, action: "role" in changes ? "user.role_changed" : row.active ? "user.activated" : "user.deactivated", entityType: "user", entityId: row.id, entityRef: row.email, details: changes });
  if (!row) return Response.json({ error: "Хэрэглэгч олдсонгүй." }, { status: 404 });
  const { passwordHash: _passwordHash, ...visible } = row;
  return Response.json({ user: visible });
}
