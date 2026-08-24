import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { bookings, products } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { bookingForRole, requireRole } from "../../authz";

export async function GET() {
  try {
    const auth = await requireRole(["admin", "operator", "mechanic"]); if ("response" in auth) return auth.response;
    const rows = await getDb().select().from(bookings).orderBy(desc(bookings.bookingDate), desc(bookings.bookingTime), desc(bookings.id)).limit(500);
    return Response.json({ bookings: rows.map((row) => bookingForRole({ ...row, date: row.bookingDate, time: row.bookingTime }, auth.user.role)) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Бүртгэл уншихад алдаа гарлаа." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(["admin", "operator"]); if ("response" in auth) return auth.response;
    const body = await request.json() as Record<string, unknown>;
    const required = ["customer", "phone", "plate", "vehicle", "branch", "date", "time"];
    if (required.some((key) => typeof body[key] !== "string" || !(body[key] as string).trim())) {
      return Response.json({ error: "Заавал бөглөх мэдээлэл дутуу байна." }, { status: 400 });
    }
    const productId = Number(body.productId);
    const [product] = await getDb().select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product || !product.active) return Response.json({ error: "Идэвхтэй бүтээгдэхүүн сонгоно уу." }, { status: 400 });
    const totalPrice = product.price;
    const advance = Math.max(0, Number(body.advance) || 0);
    if (!totalPrice) return Response.json({ error: "Нийт үнийн дүнг оруулна уу." }, { status: 400 });
    if (advance > totalPrice) return Response.json({ error: "Урьдчилгаа нийт үнээс их байж болохгүй." }, { status: 400 });
    const [row] = await getDb().insert(bookings).values({
      customer: String(body.customer).trim(), phone: String(body.phone).trim(), plate: String(body.plate).trim().toUpperCase(),
      vehicle: String(body.vehicle).trim(), productId: product.id, productName: product.name, branch: String(body.branch), bookingDate: String(body.date), bookingTime: String(body.time),
      totalPrice, advance, finalPaid: 0, receipt: String(body.receipt ?? "").trim(), status: advance > 0 ? "Баталгаажсан" : "Хүлээгдэж буй",
    }).returning();
    return Response.json({ booking: { ...row, date: row.bookingDate, time: row.bookingTime } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Захиалга хадгалахад алдаа гарлаа.";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "Сонгосон салбар тухайн өдөр аль хэдийн захиалгатай байна." }, { status: 409 });
    return Response.json({ error: message }, { status: 500 });
  }
}
