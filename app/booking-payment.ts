import { balance } from "./dashboard-metrics";
import { InputError, money } from "./input-validation";

type PaymentState = { totalPrice: number; advance: number; finalPaid: number; status: string };
export class PaymentConflictError extends Error {}

// finalPaid is an absolute cumulative amount, not a newly received delta.
// Call only with the current booking held under SELECT ... FOR UPDATE.
export function paymentFinalPaid(current: PaymentState, absoluteAmount?: number, paymentAmount?: number): number {
  const total = money(current.totalPrice);
  const advance = money(current.advance);
  const paid = money(current.finalPaid);
  if (current.status === "cancelled" || current.status === "Цуцлагдсан") {
    throw new PaymentConflictError("Цуцлагдсан захиалгын төлбөрийг авах боломжгүй.");
  }
  if (paymentAmount !== undefined) {
    const amount = money(paymentAmount);
    if (!amount) throw new InputError("Төлөх дүн 0-ээс их байх ёстой.");
    if (amount > balance(current)) throw new PaymentConflictError("Үлдэгдэл өөрчлөгдсөн эсвэл төлөх дүн үлдэгдлээс их байна. Захиалгаа шинэчилж дахин шалгана уу.");
    return paid + amount;
  }
  if (absoluteAmount === undefined) return paid + balance(current);
  const target = money(absoluteAmount);
  if (target < paid) throw new PaymentConflictError("Төлбөрийн мэдээлэл өөрчлөгдсөн байна. Шинэчилж дахин оролдоно уу.");
  if (target > paid && target > Math.max(0, total - advance)) {
    throw new InputError("Эцсийн төлбөр нийт төлөх дүнгээс их байж болохгүй.");
  }
  return target;
}
