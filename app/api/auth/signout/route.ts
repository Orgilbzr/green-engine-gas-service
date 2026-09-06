import { authErrorResponse } from "../../../auth-errors";
import { clearEmailSession } from "../../../email-auth";
import { NO_STORE_HEADERS } from "../../../../db";

export const dynamic = "force-dynamic";

export async function POST() {
	try { await clearEmailSession(); return Response.json({ ok: true }, { headers: NO_STORE_HEADERS }); }
	catch { return authErrorResponse({ route: "POST /api/auth/signout", requestId: crypto.randomUUID(), stage: "response" }, "Системээс гарах үед алдаа гарлаа."); }
}

export async function GET(request: Request) {
	try {
		await clearEmailSession();
		const location = new URL("/login", request.url).toString();
		return new Response(null, {
			status: 303,
			headers: { Location: location, ...NO_STORE_HEADERS },
		});
	} catch {
		return authErrorResponse({ route: "GET /api/auth/signout", requestId: crypto.randomUUID(), stage: "response" }, "Системээс гарах үед алдаа гарлаа.");
	}
}
