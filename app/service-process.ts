export const processSteps = ["programming", "installation", "handover"] as const;
export type ProcessStep = typeof processSteps[number];
export type ActorSnapshot = { id: number | null; name: string; role: string };
export type ProcessState = Partial<Record<`${ProcessStep}Completed`, boolean> & Record<`${ProcessStep}CompletedAt`, string | null> & Record<`${ProcessStep}CompletedBy`, ActorSnapshot | null>> & { hasArrived?: boolean; arrivedAt?: string | null; arrivedBy?: ActorSnapshot | null };
// Arrival remains derived from the earliest retained service visit, never a second flag.
export function arrivalState(visits: { visitedAt: Date | string; recordedBy: ActorSnapshot }[]) {
  const first = visits.reduce<typeof visits[number] | null>((earliest, visit) =>
    !earliest || new Date(visit.visitedAt).getTime() < new Date(earliest.visitedAt).getTime() ? visit : earliest, null);
  return { hasArrived: !!first, arrivedAt: first ? new Date(first.visitedAt).toISOString() : null, arrivedBy: first?.recordedBy ?? null };
}
export function formatProcessTimestamp(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ulaanbaatar", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("month")}/${part("day")} · ${part("hour")}:${part("minute")}`;
}
export const stepLabels = { programming: "Программ уншуулсан", installation: "Төхөөрөмж суурилуулсан", handover: "Хүлээлгэн өгсөн" };
export const purposeLabels = { programming: "Программ уншуулах", installation: "Төхөөрөмж суурилуулах", inspection: "Үзлэг", other: "Бусад" };
export function processStatus(state: ProcessState) {
  if (state.handoverCompleted) return { color: "blue", label: "Хүлээлгэн өгсөн" };
  if (state.programmingCompleted && state.installationCompleted) return { color: "purple", label: "Бүрэн дууссан" };
  if (state.programmingCompleted) return { color: "yellow", label: "Программ уншуулсан — Суурилуулалт хүлээж байна" };
  if (state.installationCompleted) return { color: "orange", label: "Төхөөрөмж суурилуулсан — Программ хүлээж байна" };
  return { color: "green", label: "Үндсэн захиалга" };
}
