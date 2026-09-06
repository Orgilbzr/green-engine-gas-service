import { validDate, validTime, text, inputErrorResponse } from "../../../input-validation";
import { checkRateLimit, authenticatedRateLimitIdentity } from "../../../rate-limit";
import { getHealthyDb, logSlowOperation, safeErrorResponse } from "../../../../db";
import { checkBookingDuplicates } from "../../../booking-duplicates";
import { requireRole } from "../../../authz";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireRole(["admin", "operator"]);
  if ("response" in auth) return auth.response;
  try {
    const limited = await checkRateLimit("duplicate-user", authenticatedRateLimitIdentity(auth.user), { route: "GET /api/bookings/duplicate-check", requestId: crypto.randomUUID() });
    if ("response" in limited) return limited.response;
    const params = new URL(request.url).searchParams;
    if (params.get("bookingDate")) validDate(params.get("bookingDate"));
    if (params.get("bookingTime")) validTime(params.get("bookingTime"));
    text(params.get("phone") || "", 40, "Утас");
    text(params.get("plate") || "", 40, "Улсын дугаар");
    const duplicate = await checkBookingDuplicates(await getHealthyDb(), {
      phone: params.get("phone") || "",
      plate: params.get("plate") || "",
      bookingDate: params.get("bookingDate") || "",
      bookingTime: params.get("bookingTime") || "",
    });
    const response = Response.json({ duplicate });
    logSlowOperation("GET /api/bookings/duplicate-check", startedAt, 200);
    return response;
  } catch (error) {
    const invalidInput = inputErrorResponse(error); if (invalidInput) return invalidInput;
    logSlowOperation("GET /api/bookings/duplicate-check", startedAt, 503, "database");
    return safeErrorResponse(error, "Давхардсан бүртгэл шалгах боломжгүй.");
  }
}
