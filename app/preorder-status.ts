export const CONVERTED_PREORDER_STATUSES = ["converted", "Үндсэн захиалга болсон"];
export type PreorderFilter = "active" | "cancelled" | "all";

export function operationalPreorderStatus(item: { status: string; convertedBookingId?: number | null }) {
  if (item.convertedBookingId || CONVERTED_PREORDER_STATUSES.includes(item.status)) return "converted";
  if (item.status === "cancelled" || item.status === "Цуцлагдсан") return "cancelled";
  if (["new", "contacted", "active", "Шинэ", "Холбогдсон"].includes(item.status)) return "new";
  return "unknown";
}

export function matchesPreorderFilter(item: { status: string; convertedBookingId?: number | null }, filter: PreorderFilter) {
  const status = operationalPreorderStatus(item);
  return status !== "converted" && (filter === "all" || status === (filter === "active" ? "new" : "cancelled"));
}
