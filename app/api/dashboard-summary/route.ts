import { sql } from "drizzle-orm";
import { getHealthyDb, isDatabaseConnectionError, databaseErrorResponse, NO_STORE_HEADERS, safeErrorResponse } from "../../../db";
import { requireRole } from "../../authz";
import { type DashboardSummary } from "../../dashboard-metrics";

import { dashboardParams, dashboardScope, dashboardQueueCondition } from "../../dashboard-queues";
import { inputErrorResponse } from "../../input-validation";

export const runtime = "nodejs";

export async function GET(request?: Request) {
  try {
    const auth = await requireRole(["admin", "operator", "mechanic"]);
    if ("response" in auth) return auth.response;

    const { branch } = dashboardParams(request);
    const db = await getHealthyDb();
    const outstanding = auth.user.role === "mechanic"
      ? sql`null::bigint`
      : sql`coalesce(sum(greatest(0::bigint, total_price::bigint - advance::bigint - final_paid::bigint)), 0)`;
    const outstandingCount = auth.user.role === "mechanic"
      ? sql`null::bigint`
      : sql`count(*) filter (where greatest(0::bigint, total_price::bigint - advance::bigint - final_paid::bigint) > 0)`;
    const advanceUnpaid = auth.user.role === "mechanic" ? sql`null::bigint` : sql`count(*) filter (where ${dashboardQueueCondition("advance-unpaid")})`;
    const [row] = await db.execute(sql<{
      programmingPending: string | number;
      installationPending: string | number;
      neitherCompleted: string | number;
      advanceUnpaid: string | number | null;
      outstandingBalance: string | number | null;
      outstandingCount: string | number | null;
    }>`
      select
        count(*) filter (where ${dashboardQueueCondition("installed-not-programmed")}) as "programmingPending",
        count(*) filter (where ${dashboardQueueCondition("programmed-not-installed")}) as "installationPending",
        count(*) filter (where ${dashboardQueueCondition("neither-completed")}) as "neitherCompleted",
        ${advanceUnpaid} as "advanceUnpaid",
        ${outstanding} as "outstandingBalance",
        ${outstandingCount} as "outstandingCount"
      from public.bookings
      where ${dashboardScope(branch)}
    `);
    if (!row) throw new Error("Dashboard summary result is missing");
    const counts = {
      programmingPending: Number(row.programmingPending),
      installationPending: Number(row.installationPending),
      neitherCompleted: Number(row.neitherCompleted),
    };
    const unpaidCount = row.advanceUnpaid === null ? null : Number(row.advanceUnpaid);
    const outstandingBalance = row.outstandingBalance === null ? null : Number(row.outstandingBalance);
    const collectibleCount = row.outstandingCount === null ? null : Number(row.outstandingCount);
    if (![...Object.values(counts), unpaidCount, outstandingBalance, collectibleCount].every(
      (value) => value === null || (Number.isSafeInteger(value) && value >= 0)) ||
      (auth.user.role !== "mechanic" && (unpaidCount === null || outstandingBalance === null || collectibleCount === null))) {
      throw new Error("Dashboard summary result is invalid");
    }
    const summary: DashboardSummary = auth.user.role === "mechanic"
      ? counts
      : { ...counts, advanceUnpaid: unpaidCount!, outstandingBalance: outstandingBalance!, outstandingCount: collectibleCount! };
    return Response.json(summary, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const invalid = inputErrorResponse(error); if (invalid) return invalid;
    if (isDatabaseConnectionError(error)) return databaseErrorResponse(error, "Хураангуйг ачаалж чадсангүй.");
    return safeErrorResponse(error, "Хураангуйг ачаалж чадсангүй.");
  }
}
