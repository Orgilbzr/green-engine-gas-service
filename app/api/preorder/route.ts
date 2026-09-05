import { and, eq, gte } from "drizzle-orm";
import { createRequestDiagnostics, databaseErrorResponse, getDb, isDatabaseConnectionError, logSlowOperation, safeErrorResponse } from "../../../db";
import { preBookings } from "../../../db/schema";
import { writeAuditLog } from "../../audit";
import { manufactureYearDatabaseError, parseManufactureYear } from "../../manufacture-year";

const VALID_SOURCES = new Set(["manual", "facebook", "website"]);
const MAX_LENGTHS = {
  customer: 120,
  phone: 40,
  vehicle: 120,
  plate: 40,
  note: 500,
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const diagnostics = createRequestDiagnostics("POST /api/preorder");
  diagnostics.stage("route_start");
  try {
    diagnostics.stage("route_validation_start");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const sourceParam = String(new URL(request.url).searchParams.get("source") ?? body.source ?? "website").trim().toLowerCase();
    const source = VALID_SOURCES.has(sourceParam) ? sourceParam : "website";

    const honeypot = String(body.honeypot ?? "").trim();
    if (honeypot) {
      return Response.json({ error: "Урьдчилсан захиалга бүртгэх боломжгүй байна." }, { status: 400 });
    }

    const customer = sanitizeText(body.customer, MAX_LENGTHS.customer);
    const phone = sanitizeText(body.phone, MAX_LENGTHS.phone);
    const vehicle = sanitizeText(body.vehicle, MAX_LENGTHS.vehicle);
    const plate = sanitizeText(body.plate, MAX_LENGTHS.plate, true);
    const note = sanitizeText(body.note, MAX_LENGTHS.note, true);

    if (!customer || !phone || !vehicle) {
      return Response.json({ error: "Нэр, утас, автомашины марк/модель заавал бөглөх шаардлагатай." }, { status: 400 });
    }
    const manufactureYearResult = parseManufactureYear(body.manufactureYear);
    if (manufactureYearResult.error) return Response.json({ error: manufactureYearResult.error }, { status: 400 });
    const manufactureYear = manufactureYearResult.year!;
    diagnostics.stage("route_validation_complete");

    if (!/^[0-9+\-\s()]+$/.test(phone)) {
      return Response.json({ error: "Утасны дугаар буруу байна." }, { status: 400 });
    }

    const recentWindow = new Date(Date.now() - 15 * 60 * 1000);
    const [recent] = await getDb().select().from(preBookings).where(and(
      eq(preBookings.phone, phone),
      eq(preBookings.vehicle, vehicle),
      gte(preBookings.createdAt, recentWindow),
    )).limit(1);

    if (recent) {
      return Response.json({ error: "Таны урьдчилсан захиалга аль хэдийн бүртгэгдсэн байна. Манай ажилтан тантай холбогдох болно." }, { status: 429 });
    }

    const [row] = await getDb().transaction(async (tx) => {
      diagnostics.stage("preorder_insert_start");
      const [created] = await tx.insert(preBookings).values({
      customer,
      phone,
      vehicle,
      plate: plate || null,
      manufactureYear,
      source,
      note,
      status: "new",
      }).returning();
      diagnostics.stage("preorder_insert_complete");
      diagnostics.stage("audit_start");
      await writeAuditLog({ db: tx, actor: null, action: "preorder.created", entityType: "preorder", entityId: created.id, entityRef: `PRE-${created.id}`, details: { customer, plate, manufacture_year: created.manufactureYear, source } });
      diagnostics.stage("audit_complete");
      return [created];
    });

    const response = Response.json({ ok: true, preBooking: row }, { status: 201 });
    diagnostics.stage("response");
    logSlowOperation("POST /api/preorder", startedAt, 201);
    return response;
  } catch (error) {
    logSlowOperation("POST /api/preorder", startedAt, isDatabaseConnectionError(error) ? 503 : 500, isDatabaseConnectionError(error) ? "database" : undefined);
    const manufactureYearError = manufactureYearDatabaseError(error);
    if (manufactureYearError) return Response.json({ error: manufactureYearError }, { status: 400 });
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Урьдчилсан захиалга хадгалах боломжгүй.");
    const message = error instanceof Error ? error.message : "Урьдчилсан захиалга хадгалах боломжгүй.";
    return message.includes("duplicate") || message.includes("UNIQUE")
      ? Response.json({ error: "Бүртгэл аль хэдийн байна." }, { status: 500 })
      : safeErrorResponse(error, "Урьдчилсан захиалга хадгалах боломжгүй.");
  }
}

function sanitizeText(value: unknown, max: number, allowEmpty = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!allowEmpty && !text) return "";
  return text.slice(0, max);
}
