export type NoteTarget = { kind: "bookings" | "preorders"; id: number; label: string };
export type NoteSummary = { noteCount: number; latestNote: string | null };
export type HistoryNote = {
  id: number; note: string; createdAt: string; legacy: boolean;
  createdBy: { id: number | null; name: string; role: string };
};
export function noteDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}.${part("month")}.${part("day")} · ${part("hour")}:${part("minute")}`;
}
