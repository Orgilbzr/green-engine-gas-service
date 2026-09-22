import type { ProcessState } from "./service-process";

// Programming and installation stay independent (no fixed order); the combination
// keys below describe common operator states without changing that business rule.
export const serviceFilters = {
  programming: "Программ уншуулсан",
  "programming-pending": "Программ дутуу",
  installation: "Төхөөрөмж суурилуулсан",
  "installation-pending": "Төхөөрөмж дутуу",
  "installed-not-programmed": "Төхөөрөмж тавьсан · Программ дутуу",
  "programmed-not-installed": "Программ уншуулсан · Төхөөрөмж дутуу",
  "ready-for-handover": "Хүлээлгэн өгөхөд бэлэн",
  handover: "Хүлээлгэн өгсөн",
  "incomplete-handover": "⚠ Дутуу үйлчилгээтэй хүлээлгэн өгсөн",
};
// Grouping keeps the filter menu scannable instead of one long flat list.
export const serviceFilterGroups: { label: string; options: Exclude<ServiceFilter, "">[] }[] = [
  { label: "Ажил дутуу", options: ["installed-not-programmed", "programmed-not-installed", "ready-for-handover"] },
  { label: "Үйлчилгээ", options: ["programming", "programming-pending", "installation", "installation-pending", "handover"] },
  { label: "Анхаарах", options: ["incomplete-handover"] },
];
export const paymentFilters = { paid: "Төлөгдсөн", balance: "Үлдэгдэлтэй", unpaid: "Төлөгдөөгүй" };
export type ServiceFilter = "" | keyof typeof serviceFilters;
export type PaymentFilter = "" | keyof typeof paymentFilters;
type FilterBooking = ProcessState & { totalPrice?: number; advance?: number; finalPaid?: number; advancePaid?: boolean; balancePaid?: boolean };

// remaining is supplied by the booking list's existing balance calculation.
export function matchesBookingFilters(b: FilterBooking, service: ServiceFilter, payment: PaymentFilter, remaining: number) {
  const programming = b.programmingCompleted === true;
  const installation = b.installationCompleted === true;
  const handover = b.handoverCompleted === true;
  const services: Record<Exclude<ServiceFilter, "">, boolean> = {
    programming, "programming-pending": !programming,
    installation, "installation-pending": !installation,
    "installed-not-programmed": installation && !programming,
    "programmed-not-installed": programming && !installation,
    "ready-for-handover": programming && installation && !handover,
    handover: programming && installation && handover,
    "incomplete-handover": handover && (!programming || !installation),
  };
  if (service && !services[service]) return false;
  if (!payment) return true;
  // Mechanics receive only the existing payment flags, never financial amounts.
  const paid = b.totalPrice === undefined ? b.balancePaid === true : remaining === 0;
  const hasPayment = b.totalPrice === undefined ? b.advancePaid === true || b.balancePaid === true : (b.advance || 0) + (b.finalPaid || 0) > 0;
  return payment === "paid" ? paid : payment === "balance" ? !paid : !paid && !hasPayment;
}
