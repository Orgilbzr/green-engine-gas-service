import { getAppUser } from "../../authz";
import { createRequestDiagnostics, NO_STORE_HEADERS, safeErrorResponse } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics = createRequestDiagnostics("GET /api/me");
  diagnostics.stage("route_start");
  try {
    diagnostics.stage("session_lookup_start");
    const user = await getAppUser(diagnostics.stage);
    diagnostics.stage("session_lookup_complete");
    if (!user) return Response.json({ error: "Эрхгүй хэрэглэгч" }, { status: 403, headers: NO_STORE_HEADERS });
    diagnostics.stage("response");
    return Response.json({ user }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    diagnostics.stage("response");
    return safeErrorResponse(error, "Нэвтрэлтийг шалгах боломжгүй байна.", 503);
  }
}
