import { authErrorResponse } from "../../auth-errors";
import { getAppUser } from "../../authz";
import { createRequestDiagnostics, NO_STORE_HEADERS } from "../../../db";

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
  } catch {
    diagnostics.stage("response");
    return authErrorResponse({ route: "GET /api/me", requestId: diagnostics.requestId, stage: "response" }, "Нэвтрэлтийг шалгах боломжгүй байна.");
  }
}
