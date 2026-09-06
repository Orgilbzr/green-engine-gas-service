import { checkRequestOrigin } from "../../../request-origin";
import { authErrorResponse } from "../../../auth-errors";
import { clearEmailSession } from "../../../email-auth";
import { NO_STORE_HEADERS } from "../../../../db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejectedOrigin = checkRequestOrigin(request);
  if (rejectedOrigin) return rejectedOrigin;
  try {
    await clearEmailSession();
    if (request.headers.get("accept")?.includes("text/html")) {
      return new Response(null, { status: 303, headers: { Location: "/login", ...NO_STORE_HEADERS } });
    }
    return Response.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch {
    return authErrorResponse({ route: "POST /api/auth/signout", requestId: crypto.randomUUID(), stage: "response" }, "Системээс гарах үед алдаа гарлаа.");
  }
}

// Legacy links do not revoke a session. The app uses a POST form for logout.
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...NO_STORE_HEADERS } });
}
