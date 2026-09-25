import { sql } from "drizzle-orm";
import { getHealthyDb, isDatabaseConnectionError, databaseErrorResponse, NO_STORE_HEADERS, safeErrorResponse } from "../../../db";
import { requireRole } from "../../authz";
import { activeMainStatuses, type DashboardSummary } from "../../dashboard-metrics";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireRole(["admin", "operator", "mechanic"]);
    if ("response" in auth) return auth.response;

    const db = await getHealthyDb();
    const outstanding = auth.user.role === "mechanic"
      ? sql`null::bigint`
      : sql`coalesce(sum(greatest(0::bigint, total_price::bigint - advance::bigint - final_paid::bigint)), 0)`;
    const [row] = await db.execute(sql<{
      programmingPending: string | number;
      installationPending: string | number;
      handoverPending: string | number;
      outstandingBalance: string | number | null;
    }>`
      select
        count(*) filter (where programming_completed is not true) as "programmingPending",
        count(*) filter (where installation_completed is not true) as "installationPending",
        count(*) filter (where handover_completed is not true) as "handoverPending",
        ${outstanding} as "outstandingBalance"
      from public.bookings
      where status in (${sql.join(activeMainStatuses.map((status) => sql`${status}`), sql`, `)})
        and returned_to_preorder_at is null
    `);
    if (!row) throw new Error("Dashboard summary result is missing");
    const counts = {
      programmingPending: Number(row.programmingPending),
      installationPending: Number(row.installationPending),
      handoverPending: Number(row.handoverPending),
    };
    const outstandingBalance = row.outstandingBalance === null ? null : Number(row.outstandingBalance);
    if (![...Object.values(counts), outstandingBalance].every(
      (value) => value === null || (Number.isSafeInteger(value) && value >= 0)) ||
      (auth.user.role !== "mechanic" && outstandingBalance === null)) {
      throw new Error("Dashboard summary result is invalid");
    }
    const summary: DashboardSummary = auth.user.role === "mechanic"
      ? counts
      : { ...counts, outstandingBalance: outstandingBalance! };
    return Response.json(summary, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Хураангуйг ачаалж чадсангүй.");
    return safeErrorResponse(error, "Хураангуйг ачаалж чадсангүй.");
  }
}
