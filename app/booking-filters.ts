import type { ProcessState } from "./service-process";

export const serviceFilters = {
  programming: "Программ уншуулсан",
  "programming-pending": "Программ дутуу",
  installation: "Төхөөрөмж суурилуулсан",
  "installation-pending": "Төхөөрөмж дутуу",
  complete: "Бүрэн дууссан",
  handover: "Хүлээлгэн өгсөн",
  "incomplete-handover": "Хүлээлгэн өгсөн боловч үйлчилгээ дутуу",
};
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
    complete: programming && installation,
    handover, "incomplete-handover": handover && (!programming || !installation),
  };
  if (service && !services[service]) return false;
  if (!payment) return true;
  // Mechanics receive only the existing payment flags, never financial amounts.
  const paid = b.totalPrice === undefined ? b.balancePaid === true : remaining === 0;
  const hasPayment = b.totalPrice === undefined ? b.advancePaid === true || b.balancePaid === true : (b.advance || 0) + (b.finalPaid || 0) > 0;
  return payment === "paid" ? paid : payment === "balance" ? !paid : !paid && !hasPayment;
}
