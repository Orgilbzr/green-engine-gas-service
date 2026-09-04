import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { getDb, NO_STORE_HEADERS, safeErrorResponse } from "../../../db";
import { auditLogs } from "../../../db/schema";
import { requireRole } from "../../authz";

export async function GET(request: Request) {
  const auth = await requireRole(["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 50)));
    const search = params.get("search")?.trim();
    const filters = [
      params.get("action") ? eq(auditLogs.action, params.get("action")!) : undefined,
      params.get("entityType") ? eq(auditLogs.entityType, params.get("entityType")!) : undefined,
      params.get("actor") ? ilike(auditLogs.actorEmail, `%${params.get("actor")!.trim()}%`) : undefined,
      params.get("dateFrom") ? gte(auditLogs.createdAt, new Date(params.get("dateFrom")!)) : undefined,
      params.get("dateTo") ? lte(auditLogs.createdAt, new Date(`${params.get("dateTo")!}T23:59:59.999Z`)) : undefined,
      search ? or(ilike(auditLogs.entityRef, `%${search}%`), ilike(sql`${auditLogs.details}->>'plate'`, `%${search}%`), ilike(auditLogs.actorEmail, `%${search}%`), ilike(auditLogs.action, `%${search}%`)) : undefined,
    ].filter(Boolean);
    const rows = await getDb().select().from(auditLogs).where(filters.length ? and(...filters) : undefined).orderBy(desc(auditLogs.createdAt)).limit(limit).offset((page - 1) * limit);
    return Response.json({ logs: rows, page, limit }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, "Үйл ажиллагааны түүхийг уншихад алдаа гарлаа.");
  }
}