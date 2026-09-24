import { sql } from "drizzle-orm";
import { requireRole } from "../../../authz";
import { getHealthyDb } from "../../../../db";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (process.env.DB_ROLE_CHECK_ENABLED !== "true") {
    return new Response(null, { status: 404, headers: noStore });
  }

  const auth = await requireRole(["admin"]);
  if (auth.response) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }

  try {
    const db = await getHealthyDb();
    const rows = await db.execute(sql<{ current_user: string; session_user: string }>`SELECT current_user, session_user`);
    const role = rows[0];
    if (!role || typeof role.current_user !== "string" || typeof role.session_user !== "string") {
      return new Response(null, { status: 503, headers: noStore });
    }
    return Response.json({ currentUser: role.current_user, sessionUser: role.session_user }, { headers: noStore });
  } catch {
    return new Response(null, { status: 503, headers: noStore });
  }
}

export function HEAD() {
  return new Response(null, { status: 405, headers: { ...noStore, Allow: "GET" } });
}

export function OPTIONS() {
  return new Response(null, { status: 405, headers: { ...noStore, Allow: "GET" } });
}
