import { createRequestDiagnostics, databaseErrorResponse, getHealthyDb, isDatabaseConnectionError, NO_STORE_HEADERS, safeErrorResponse } from "../../../db";
import { requireRole } from "../../authz";
import { parseReportQuery, ReportValidationError, type ReportData } from "../../reports/model";
import { buildReportQuery, MAX_EXPORT_ROWS, REPORT_PAGE_SIZE } from "../../reports/query";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const diagnostics = createRequestDiagnostics("GET /api/reports");
  try {
    const auth = await requireRole(["admin", "operator"]);
    if ("response" in auth) return auth.response;
    const { filters, page, format } = parseReportQuery(new URL(request.url).searchParams);
    diagnostics.stage("db_query_start");
    const db = await getHealthyDb();
    const result = await db.execute(buildReportQuery(filters, page, format === "xlsx"));
    const report = result[0].report as Omit<ReportData, "page" | "pageSize" | "filters">;
    const data: ReportData = { ...report, filters, page, pageSize: REPORT_PAGE_SIZE };
    diagnostics.stage("db_query_complete");
    if (format === "xlsx") {
      if (data.totals.count > MAX_EXPORT_ROWS) return Response.json({ error: "Excel тайлан 50,000-аас олон захиалгатай байна. Огноо эсвэл шүүлтүүрээ нарийсгана уу." }, { status: 413, headers: NO_STORE_HEADERS });
      const { createReportWorkbook } = await import("../../reports/excel");
      const file = await createReportWorkbook(data);
      return new Response(new Uint8Array(file), { headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="green-engine-report-${filters.from}-${filters.to}.xlsx"`,
      } });
    }
    return Response.json(data, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ReportValidationError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS });
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Тайланг ачаалж чадсангүй.");
    return safeErrorResponse(error, "Тайланг ачаалж чадсангүй.");
  }
}
