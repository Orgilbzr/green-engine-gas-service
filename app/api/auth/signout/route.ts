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
		const location = new URL("/login", request.url).toString();
		return new Response(null, {
			status: 303,
			headers: { Location: location, ...NO_STORE_HEADERS },
		});
	} catch (error) {
		return safeErrorResponse(error, "Системээс гарах үед алдаа гарлаа.", 503);
	}
}