import { loginWithPassword, normalizeEmail } from "../../../email-auth";
import { NO_STORE_HEADERS, safeErrorResponse } from "../../../../db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    if (!email.includes("@") || password.length < 8 || !await loginWithPassword(email, password)) return Response.json({ error: "Имэйл эсвэл password буруу байна." }, { status: 401, headers: NO_STORE_HEADERS });
    return Response.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, "Нэвтрэх үед алдаа гарлаа.", 503);
  }
}