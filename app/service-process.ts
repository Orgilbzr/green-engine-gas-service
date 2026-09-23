export const processSteps = ["programming", "installation", "handover"] as const;
export type ProcessStep = typeof processSteps[number];
export type ActorSnapshot = { id: number | null; name: string; role: string };
export type ProcessState = Partial<Record<`${ProcessStep}Completed`, boolean> & Record<`${ProcessStep}CompletedAt`, string | null> & Record<`${ProcessStep}CompletedBy`, ActorSnapshot | null>> & { hasArrived?: boolean };
export const stepLabels = { programming: "Программ уншуулсан", installation: "Төхөөрөмж суурилуулсан", handover: "Хүлээлгэн өгсөн" };
export const purposeLabels = { programming: "Программ уншуулах", installation: "Төхөөрөмж суурилуулах", inspection: "Үзлэг", other: "Бусад" };
export function processStatus(state: ProcessState) {
  if (state.handoverCompleted) return { color: "blue", label: "Хүлээлгэн өгсөн" };
  if (state.programmingCompleted && state.installationCompleted) return { color: "purple", label: "Бүрэн дууссан" };
  if (state.programmingCompleted) return { color: "yellow", label: "Программ уншуулсан — Суурилуулалт хүлээж байна" };
  if (state.installationCompleted) return { color: "orange", label: "Төхөөрөмж суурилуулсан — Программ хүлээж байна" };
  return { color: "green", label: "Үндсэн захиалга" };
}
