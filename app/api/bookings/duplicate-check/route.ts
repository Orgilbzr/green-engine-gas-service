import { getDb, safeErrorResponse } from "../../../../db";
import { checkBookingDuplicates } from "../../../booking-duplicates";
import { requireRole } from "../../../authz";

export async function GET(request: Request) {
  const auth = await requireRole(["admin", "operator"]);
  if ("response" in auth) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const duplicate = await checkBookingDuplicates(getDb(), {
      phone: params.get("phone") || "",
      plate: params.get("plate") || "",
      bookingDate: params.get("bookingDate") || "",
      bookingTime: params.get("bookingTime") || "",
    });
    return Response.json({ duplicate });
  } catch (error) {
    return safeErrorResponse(error, "Давхардсан бүртгэл шалгах боломжгүй.");
  }
}
