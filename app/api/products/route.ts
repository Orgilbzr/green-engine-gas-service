import { asc } from "drizzle-orm";
import { requireRole } from "../../authz";
import { createRequestDiagnostics, getHealthyDb, safeErrorResponse } from "../../../db";
import { products } from "../../../db/schema";
import { writeAuditLog } from "../../audit";

export async function GET() {
  const diagnostics = createRequestDiagnostics("GET /api/products");
  diagnostics.stage("route_start");
  try {
    const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
    diagnostics.stage("db_query_start");
    const rows = await (await getHealthyDb()).select().from(products).orderBy(asc(products.name));
    diagnostics.stage("db_query_complete");
    diagnostics.stage("response");
    return Response.json({ products: auth.user.role === "admin" ? rows : rows.filter(row => row.active) });
  } catch (error) {
    diagnostics.stage("response");
    return safeErrorResponse(error, "Бүтээгдэхүүнийг ачаалж чадсангүй.");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["admin"]); if ("response" in auth) return auth.response;
  const body = await request.json() as { name?: string; price?: number };
  const name = String(body.name || "").trim(); const price = Math.max(0, Number(body.price) || 0);
  if (!name || !price) return Response.json({ error: "Бүтээгдэхүүний нэр, үнийг зөв оруулна уу." }, { status: 400 });
  try {
    const db = await getHealthyDb();
    const [row] = await db.insert(products).values({ name, price, active: true }).returning();
    await writeAuditLog({ db, action: "product.created", entityType: "product", entityId: row.id, entityRef: row.name, details: { name: row.name, price: row.price } });
    return Response.json({ product: row }, { status: 201 });
  } catch { return Response.json({ error: "Ижил нэртэй бүтээгдэхүүн бүртгэлтэй байна." }, { status: 409 }); }
}
