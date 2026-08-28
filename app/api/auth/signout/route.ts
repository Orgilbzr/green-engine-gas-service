import { clearEmailSession } from "../../../email-auth";
import { NO_STORE_HEADERS, safeErrorResponse } from "../../../../db";

export const dynamic = "force-dynamic";

export async function POST() {
	try { await clearEmailSession(); return Response.json({ ok: true }, { headers: NO_STORE_HEADERS }); }
	catch (error) { return safeErrorResponse(error, "Системээс гарах үед алдаа гарлаа.", 503); }
}

export async function GET(request: Request) {
	try {
		await clearEmailSession();
		const response = Response.redirect(new URL("/login", request.url));
		Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
		return response;
	} catch (error) {
		return safeErrorResponse(error, "Системээс гарах үед алдаа гарлаа.", 503);
	}
}