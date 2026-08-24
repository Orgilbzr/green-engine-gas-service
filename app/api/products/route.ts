import { asc } from "drizzle-orm";
import { requireRole } from "../../authz";
import { getDb } from "../../../db";
import { products } from "../../../db/schema";

export async function GET() {
  const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
  const rows = await getDb().select().from(products).orderBy(asc(products.name));
  return Response.json({ products: auth.user.role === "admin" ? rows : rows.filter(row => row.active) });
}

export async function POST(request: Request) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const body = await request.json() as { name?: string; price?: number };
  const name = String(body.name || "").trim(); const price = Math.max(0, Number(body.price) || 0);
  if (!name || !price) return Response.json({ error: "Бүтээгдэхүүний нэр, үнийг зөв оруулна уу." }, { status: 400 });
  try {
    const [row] = await getDb().insert(products).values({ name, price, active: true }).returning();
    return Response.json({ product: row }, { status: 201 });
  } catch { return Response.json({ error: "Ижил нэртэй бүтээгдэхүүн бүртгэлтэй байна." }, { status: 409 }); }
}
