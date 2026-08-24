import { eq } from "drizzle-orm";
import { requireRole } from "../../../authz";
import { getDb } from "../../../../db";
import { products } from "../../../../db/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const id = Number((await params).id); const body = await request.json() as { name?: string; price?: number; active?: boolean };
  const values: { name?: string; price?: number; active?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) values.name = body.name.trim();
  if (body.price !== undefined && Number(body.price) > 0) values.price = Number(body.price);
  if (typeof body.active === "boolean") values.active = body.active;
  const [row] = await getDb().update(products).set(values).where(eq(products.id, id)).returning();
  return row ? Response.json({ product: row }) : Response.json({ error: "Бүтээгдэхүүн олдсонгүй." }, { status: 404 });
}
