import { eq } from "drizzle-orm";
import { requireRole } from "../../../authz";
import { getHealthyDb } from "../../../../db";
import { products } from "../../../../db/schema";
import { createChangeSet, writeAuditLog } from "../../../audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const id = Number((await params).id); const body = await request.json() as { name?: string; price?: number; active?: boolean };
  const values: { name?: string; price?: number; active?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) values.name = body.name.trim();
  if (body.price !== undefined && Number(body.price) > 0) values.price = Number(body.price);
  if (typeof body.active === "boolean") values.active = body.active;
  const db = await getHealthyDb();
  const [current] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!current) return Response.json({ error: "Бүтээгдэхүүн олдсонгүй." }, { status: 404 });
  const [row] = await db.update(products).set(values).where(eq(products.id, id)).returning();
  const changes = createChangeSet(current, row, ["name", "price", "active"]);
  if (Object.keys(changes).length) await writeAuditLog({ db, action: row.active ? "product.updated" : "product.disabled", entityType: "product", entityId: row.id, entityRef: row.name, details: changes });
  return row ? Response.json({ product: row }) : Response.json({ error: "Бүтээгдэхүүн олдсонгүй." }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "Бүтээгдэхүүний дугаар буруу байна." }, { status: 400 });
  const db = await getHealthyDb();
  const [row] = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    if (!current) return [];
    const [deleted] = await tx.delete(products).where(eq(products.id, id)).returning();
    await writeAuditLog({ db: tx, actor: auth.user, action: "product.deleted", entityType: "product", entityId: deleted.id, entityRef: deleted.name, details: {} });
    return [deleted];
  });
  return row ? Response.json({ deleted: true }) : Response.json({ error: "Бүтээгдэхүүн олдсонгүй." }, { status: 404 });
}
