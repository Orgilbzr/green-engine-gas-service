import { getAppUser } from "../../authz";
import { NO_STORE_HEADERS, safeErrorResponse } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAppUser();
    if (!user) return Response.json({ error: "Эрхгүй хэрэглэгч" }, { status: 403, headers: NO_STORE_HEADERS });
    return Response.json({ user }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, "Нэвтрэлтийг шалгах боломжгүй байна.", 503);
  }
}
