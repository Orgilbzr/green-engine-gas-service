import { BOOKING_STATUSES } from "./input-validation";

export type DashboardSummary = {
  programmingPending: number;
  installationPending: number;
  handoverPending: number;
  outstandingBalance?: number;
};

export type DashboardBooking = {
  status: string;
  programmingCompleted?: boolean;
  installationCompleted?: boolean;
  handoverCompleted?: boolean;
  totalPrice?: number;
  advance?: number;
  finalPaid?: number;
  returnedToPreorderAt?: Date | string | null;
};

// The two cancellation spellings are the inactive booking statuses used by the app.
export const isActiveBooking = (booking: Pick<DashboardBooking, "status">) =>
  booking.status !== "Цуцлагдсан" && booking.status !== "cancelled";

// Keep the booking list's existing payment calculation.
export const balance = (booking: Pick<DashboardBooking, "totalPrice" | "advance" | "finalPaid">) =>
  Math.max(0, (booking.totalPrice || 0) - (booking.advance || 0) - (booking.finalPaid || 0));

export const activeMainStatuses: readonly string[] = BOOKING_STATUSES.filter((status) =>
  status !== "Цуцлагдсан" && status !== "cancelled");

export function dashboardMetrics(bookings: readonly DashboardBooking[]) {
  // /api/bookings already omits returned bookings while 0015 is enabled.
  const active = bookings.filter((booking) =>
    isActiveBooking(booking) && activeMainStatuses.includes(booking.status) &&
    booking.returnedToPreorderAt == null);
  return {
    programmingPending: active.filter((booking) => booking.programmingCompleted !== true).length,
    installationPending: active.filter((booking) => booking.installationCompleted !== true).length,
    handoverPending: active.filter((booking) => booking.handoverCompleted !== true).length,
    outstandingBalance: active.reduce((sum, booking) => sum + balance(booking), 0),
  };
}
