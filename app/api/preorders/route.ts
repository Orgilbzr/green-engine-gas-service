import { and, desc, eq, gte } from "drizzle-orm";
import { getAppUser, requireRole } from "../../authz";
import { getDb } from "../../../db";
import { preBookings } from "../../../db/schema";
import { writeAuditLog } from "../../audit";

const VALID_SOURCES = new Set(["manual", "facebook", "website"]);
const VALID_STATUSES = new Set(["new", "contacted", "converted", "cancelled"]);
const MAX_LENGTHS = {
  customer: 120,
  phone: 40,
  vehicle: 120,
  plate: 40,
  note: 500,
};

export async function GET() {
  const auth = await requireRole(["admin", "operator"]);
  if ("response" in auth) return auth.response;

  const rows = await getDb().select().from(preBookings).orderBy(desc(preBookings.createdAt));
  return Response.json({ preBookings: rows });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const url = new URL(request.url);
    const requestedSource = String(url.searchParams.get("source") ?? body.source ?? "website").trim().toLowerCase();
    const source = VALID_SOURCES.has(requestedSource) ? requestedSource : "website";

    const currentUser = await getAppUser();
    const isInternalRequest = Boolean(currentUser && ["admin", "operator"].includes(currentUser.role));

    if (!isInternalRequest) {
      const honeypot = String(body.honeypot ?? "").trim();
      if (honeypot) {
        return Response.json({ error: "Урьдчилсан захиалга бүртгэх боломжгүй байна." }, { status: 400 });
      }
    }

    const customer = sanitizeText(body.customer, MAX_LENGTHS.customer);
    const phone = sanitizeText(body.phone, MAX_LENGTHS.phone);
    const vehicle = sanitizeText(body.vehicle, MAX_LENGTHS.vehicle);
    const plate = sanitizeText(body.plate, MAX_LENGTHS.plate, true);
    const manufactureYear = body.manufactureYear === "" || body.manufactureYear === undefined || body.manufactureYear === null ? null : Number(body.manufactureYear);
    const currentYear = new Date().getFullYear();
    const note = sanitizeText(body.note, MAX_LENGTHS.note, true);

    if (!customer || !phone || !vehicle) {
      return Response.json({ error: "Нэр, утас, автомашины марк/модель заавал бөглөх шаардлагатай." }, { status: 400 });
    }
    if (manufactureYear !== null && (!Number.isInteger(manufactureYear) || manufactureYear < 1950 || manufactureYear > currentYear + 1)) {
      return Response.json({ error: `Үйлдвэрлэсэн он 1950-${currentYear + 1} хооронд бүхэл тоо байна.` }, { status: 400 });
    }

    if (!/^[0-9+\-\s()]+$/.test(phone)) {
      return Response.json({ error: "Утасны дугаар буруу байна." }, { status: 400 });
    }

    const normalizedSource = isInternalRequest ? (source === "manual" ? "manual" : source) : source;
    const status = isInternalRequest ? String(body.status ?? "new").trim().toLowerCase() : "new";
    if (isInternalRequest && !VALID_STATUSES.has(status)) {
      return Response.json({ error: "Урьдчилсан захиалгын төлөв буруу байна." }, { status: 400 });
    }

    const duplicateLookback = new Date(Date.now() - 15 * 60 * 1000);
    const [existing] = await getDb().select().from(preBookings).where(and(
      eq(preBookings.phone, phone),
      eq(preBookings.vehicle, vehicle),
      gte(preBookings.createdAt, duplicateLookback),
    )).limit(1);

    if (existing) {
      return Response.json({ error: "Таны урьдчилсан захиалга аль хэдийн бүртгэгдсэн байна. Манай ажилтан тантай холбогдох болно." }, { status: 429 });
    }

    const [row] = await getDb().transaction(async (tx) => {
      const [created] = await tx.insert(preBookings).values({
      customer,
      phone,
      vehicle,
      plate: plate || null,
      manufactureYear,
      source: normalizedSource,
      note,
      status: isInternalRequest ? status : "new",
      convertedBookingId: null,
      }).returning();
      await writeAuditLog({ db: tx, actor: isInternalRequest ? currentUser : null, action: "preorder.created", entityType: "preorder", entityId: created.id, entityRef: `PRE-${created.id}`, details: { customer, plate, manufacture_year: created.manufactureYear, source: normalizedSource } });
      return [created];
    });

    return Response.json({ ok: true, preBooking: row }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Урьдчилсан захиалга хадгалах боломжгүй.";
    return Response.json({ error: message.includes("duplicate") || message.includes("UNIQUE") ? "Бүртгэл аль хэдийн байна." : "Урьдчилсан захиалга хадгалах боломжгүй." }, { status: 500 });
  }
}

function sanitizeText(value: unknown, max: number, allowEmpty = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!allowEmpty && !text) return "";
  const trimmed = text.slice(0, max);
  return trimmed;
}
