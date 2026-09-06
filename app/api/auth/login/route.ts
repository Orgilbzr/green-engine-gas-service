import { authErrorResponse } from "../../../auth-errors";
import { loginWithPassword, normalizeEmail } from "../../../email-auth";
import { createRequestDiagnostics, NO_STORE_HEADERS } from "../../../../db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const diagnostics = createRequestDiagnostics("POST /api/auth/login");
  diagnostics.stage("route_start");
  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    if (!email.includes("@") || password.length < 8 || !await loginWithPassword(email, password, diagnostics.stage)) return Response.json({ error: "Имэйл эсвэл password буруу байна." }, { status: 401, headers: NO_STORE_HEADERS });
    diagnostics.stage("response");
    return Response.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch {
    diagnostics.stage("response");
    return authErrorResponse({ route: "POST /api/auth/login", requestId: diagnostics.requestId, stage: "response" }, "Нэвтрэх үед алдаа гарлаа.");
  }
}
