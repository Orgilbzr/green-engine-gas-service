import { clearEmailSession } from "../../../email-auth";

export async function POST() { await clearEmailSession(); return Response.json({ ok: true }); }

export async function GET(request: Request) { await clearEmailSession(); return Response.redirect(new URL("/login", request.url)); }