// Pure startup-sequencing helper: lets /api/me and the booking fetch begin
// concurrently instead of the booking fetch waiting on /api/me to resolve
// first. /api/bookings already authorizes itself, so it does not need the
// /api/me response to start; /api/me remains the sole source of truth for
// the authenticated user/role.
export type DashboardMeResponse = { user?: { role: string; email: string; name: string } };

export type DashboardStartupDeps<TUser> = {
  fetchMe: (signal: AbortSignal) => Promise<{ user?: TUser }>;
  fetchBookings: (signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
};

export type DashboardStartupResult<TUser> =
  | { kind: "aborted" }
  | { kind: "unauthenticated"; reason: unknown }
  | { kind: "authenticated"; user: TUser; bookingsError?: unknown };

export async function runDashboardStartup<TUser>(deps: DashboardStartupDeps<TUser>): Promise<DashboardStartupResult<TUser>> {
  const { fetchMe, fetchBookings, signal } = deps;
  // Both requests start in the same tick; neither awaits the other.
  const [meResult, bookingsResult] = await Promise.allSettled([fetchMe(signal), fetchBookings(signal)]);
  if (signal.aborted) return { kind: "aborted" };
  if (meResult.status === "rejected") return { kind: "unauthenticated", reason: meResult.reason };
  if (!meResult.value.user) return { kind: "unauthenticated", reason: new Error("Authenticated user is missing") };
  return {
    kind: "authenticated",
    user: meResult.value.user,
    bookingsError: bookingsResult.status === "rejected" ? bookingsResult.reason : undefined,
  };
}
