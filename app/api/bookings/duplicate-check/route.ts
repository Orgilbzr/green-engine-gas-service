import { getHealthyDb, logSlowOperation, safeErrorResponse } from "../../../../db";
import { checkBookingDuplicates } from "../../../booking-duplicates";
import { requireRole } from "../../../authz";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireRole(["admin", "operator"]);
  if ("response" in auth) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
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
    logSlowOperation("GET /api/bookings/duplicate-check", startedAt, 503, "database");
    return safeErrorResponse(error, "Давхардсан бүртгэл шалгах боломжгүй.");
  }
}
