import { eq } from "drizzle-orm";
import { requireRole, type Role } from "../../../authz";
import { getDb } from "../../../../db";
import { appUsers } from "../../../../db/schema";

const roles: Role[] = ["admin", "operator", "mechanic"];
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const id = Number((await params).id); const body = await request.json() as { role?: Role; active?: boolean };
  const values: { role?: Role; active?: boolean } = {};
  if (body.role && roles.includes(body.role)) values.role = body.role;
  if (typeof body.active === "boolean") values.active = body.active;
  const [row] = await getDb().update(appUsers).set(values).where(eq(appUsers.id, id)).returning();
  return row ? Response.json({ user: row }) : Response.json({ error: "Хэрэглэгч олдсонгүй." }, { status: 404 });
}
