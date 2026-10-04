import { balance } from "./dashboard-metrics";
import type { ProcessState } from "./service-process";

export type BookingSortKey = "registered" | "customer" | "vehicle" | "schedule" | "progress" | "payment";
export type BookingSort = { key: BookingSortKey; direction: "asc" | "desc" } | null;

type SortableBooking = ProcessState & {
  id: number;
  createdAt?: string | null;
  customer: string;
  plate: string;
  vehicle: string;
  date: string;
  time: string;
  totalPrice?: number;
  advance?: number;
  finalPaid?: number;
  balancePaid?: boolean;
};

const collator = new Intl.Collator("mn", { sensitivity: "base", numeric: true });
const text = (a: string | undefined, b: string | undefined) => collator.compare(a || "", b || "");

// Same formula as BookingProgress; kept here so sorting never alters the displayed value.
export const progressPercent = (b: ProcessState) =>
  Math.round((Number(!!b.programmingCompleted) + Number(!!b.installationCompleted) + Number(!!b.handoverCompleted)) / 3 * 100);

// Mechanics receive no amounts, so they sort by the existing paid flag instead.
const outstanding = (b: SortableBooking) => (b.totalPrice === undefined ? (b.balancePaid ? 0 : 1) : balance(b));

// Registration order uses the real timestamp; a missing or unparsable value sorts as oldest.
const registered = (b: SortableBooking) => { const t = b.createdAt ? Date.parse(b.createdAt) : NaN; return Number.isNaN(t) ? 0 : t; };

const schedule = (b: SortableBooking) => `${b.date} ${b.time}`;

const primary = (key: BookingSortKey, a: SortableBooking, b: SortableBooking): number => {
  switch (key) {
    case "registered": return registered(a) - registered(b);
    case "customer": return text(a.customer, b.customer);
    case "vehicle": return text(a.vehicle, b.vehicle) || text(a.plate, b.plate);
    case "schedule": return schedule(a) < schedule(b) ? -1 : schedule(a) > schedule(b) ? 1 : 0;
    case "progress": return progressPercent(a) - progressPercent(b);
    case "payment": return outstanding(a) - outstanding(b);
  }
};

// Returns a sorted copy; the input array is never mutated. Ties fall back to id so order is stable.
export function sortBookings<T extends SortableBooking>(rows: readonly T[], sort: BookingSort): T[] {
  if (!sort) return [...rows];
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * primary(sort.key, a, b) || a.id - b.id);
}

// Same column cycles ascending -> descending -> no sort (null restores the default order).
export function nextSort(current: BookingSort, key: BookingSortKey): BookingSort {
  if (current?.key !== key) return { key, direction: "asc" };
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}
