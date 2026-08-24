import { loginWithPassword, normalizeEmail } from "../../../email-auth";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string };
  const email = normalizeEmail(String(body.email || ""));
  const password = String(body.password || "");
  if (!email.includes("@") || password.length < 8 || !await loginWithPassword(email, password)) return Response.json({ error: "Имэйл эсвэл password буруу байна." }, { status: 401 });
  return Response.json({ ok: true });
}