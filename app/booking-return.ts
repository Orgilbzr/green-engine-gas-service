export type ReturnCandidate = {
  status: string;
  advance: number;
  finalPaid: number;
  programmingCompleted: boolean;
  installationCompleted: boolean;
  handoverCompleted: boolean;
};

export function returnIneligibleReason(booking: ReturnCandidate, hasVisit: boolean, alreadyReturned: boolean): string | null {
  if (alreadyReturned || !["Хүлээгдэж буй", "Баталгаажсан", "Суурилуулж байна"].includes(booking.status)) return "Идэвхгүй захиалгыг буцаах боломжгүй.";
  if (hasVisit) return "Ирэлт бүртгэгдсэн захиалгыг буцаах боломжгүй.";
  if (booking.programmingCompleted || booking.installationCompleted || booking.handoverCompleted) return "Үйлчилгээний явц бүртгэгдсэн захиалгыг буцаах боломжгүй.";
  if (booking.advance !== 0 || booking.finalPaid !== 0) return "Төлбөр бүртгэгдсэн захиалгыг буцаах боломжгүй.";
  return null;
}
