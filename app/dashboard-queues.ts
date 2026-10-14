import { sql } from "drizzle-orm";
import { BRANCHES, InputError } from "./input-validation";
import { activeMainStatuses } from "./dashboard-metrics";

export const dashboardQueues = ["installed-not-programmed", "programmed-not-installed", "work-pending", "advance-unpaid"] as const;
export type DashboardQueue = typeof dashboardQueues[number];

export function dashboardScope(branch: string) {
  return sql`status in (${sql.join(activeMainStatuses.map(status => sql`${status}`), sql`, `)})
    and returned_to_preorder_at is null
    ${branch ? sql`and branch = ${branch}` : sql``}`;
}

// NOT NULL defaults are false; IS NOT TRUE also preserves legacy incomplete NULLs.
export function dashboardQueueCondition(queue: DashboardQueue) {
  if (queue === "advance-unpaid") return sql`advance::bigint + final_paid::bigint = 0`;
  if (queue === "installed-not-programmed") return sql`installation_completed is true and programming_completed is not true`;
  if (queue === "programmed-not-installed") return sql`programming_completed is true and installation_completed is not true`;
  return sql`(programming_completed is not true or installation_completed is not true)`;
}

export function dashboardParams(request?: Request) {
  const params = new URL(request?.url ?? "http://localhost").searchParams;
  const branch = params.get("branch") ?? "";
  const queue = params.get("dashboardQueue") ?? "";
  if (branch && !(BRANCHES as readonly string[]).includes(branch)) throw new InputError("Салбар буруу байна.");
  if (queue && !(dashboardQueues as readonly string[]).includes(queue)) throw new InputError("Хяналтын самбарын шүүлтүүр буруу байна.");
  return { branch, queue: queue as DashboardQueue | "" };
}
