"use client";
import { useEffect, useRef, useState } from "react";
import { processStatus, processSteps, purposeLabels, stepLabels, type ActorSnapshot, type ProcessState } from "./service-process";

type Booking = ProcessState & { id: number; bookingNo: string; plate: string; branch: string; date: string; time: string };
type Visit = { id: number; visitedAt: string; purpose: keyof typeof purposeLabels; branch: string; note: string; recordedBy: ActorSnapshot };
const roles: Record<string, string> = { admin: "Админ", operator: "Захиалгын ажилтан", mechanic: "Механик" };
const local = (value: string) => new Date(value).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
function visitDate(value: string) { return new Date(new Date(value).getTime() + 8 * 3600000).toISOString(); }
export function ProcessBadge({ booking }: { booking: ProcessState }) {
  const status = processStatus(booking);
  return <span className={`process-badge process-${status.color}`}>{status.label}</span>;
}
export default function ServiceProcess({ initial, editable, onClose, onUpdated }: { initial: Booking; editable: boolean; onClose: () => void; onUpdated: (booking: Booking) => void }) {
  const [booking, setBooking] = useState(initial), [visits, setVisits] = useState<Visit[]>([]);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [visitId, setVisitId] = useState<number | null>(null);
  const empty = { date: visitDate(new Date().toISOString()).slice(0,10), time: visitDate(new Date().toISOString()).slice(11,16), purpose: "programming", branch: initial.branch, note: "" };
  const [form, setForm] = useState(empty);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/bookings/${initial.id}/process`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setBooking(data.booking); setVisits(data.visits); setLoaded(true);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [initial.id]);
  async function mutate(payload: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true); setError("");
    try {
      const send = (body: Record<string, unknown>) => fetch(`/api/bookings/${booking.id}/process`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let response = await send(payload), data = await response.json();
      if (data.requiresConfirmation && window.confirm(data.error)) { response = await send({ ...payload, confirmIncomplete: true }); data = await response.json(); }
      if (!response.ok) throw new Error(data.error || "Хадгалах боломжгүй.");
      setBooking(data.booking); setVisits(data.visits); onUpdated(data.booking); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Хадгалах боломжгүй."); return false; }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="service-dialog" aria-labelledby="service-process-title" onCancel={onClose}>
    <div className="service-heading"><h2 id="service-process-title">Үйлчилгээний явц</h2><button type="button" onClick={onClose} aria-label="Хаах">✕</button></div>
    <p>{booking.bookingNo} · {booking.plate}</p><ProcessBadge booking={booking} />
    {error && <p role="alert" className="error">{error}</p>}
    {!loaded && !error && <p role="status">Ачаалж байна…</p>}
    <fieldset disabled={!editable || busy || !loaded} className="process-steps"><legend>Үйлчилгээний явц</legend>
      {processSteps.map(step => { const actor = booking[`${step}CompletedBy`], at = booking[`${step}CompletedAt`]; return <label key={step}>
        <span><input type="checkbox" checked={!!booking[`${step}Completed`]} onChange={e => void mutate({ action: "step", step, completed: e.target.checked })} /> {stepLabels[step]}</span>
        {at && <small>{local(at)} · {actor?.name} · {roles[actor?.role ?? ""] || actor?.role}</small>}
      </label>; })}
    </fieldset>
    {booking.handoverCompleted && (!booking.programmingCompleted || !booking.installationCompleted) && <p role="status">Анхаар: хүлээлгэн өгсөн боловч үйлчилгээ бүрэн дуусаагүй.</p>}
    <p><b>Үйлчилгээний товлол</b><br />{booking.date} · {booking.time} · {booking.branch}<br />{booking.programmingCompleted && !booking.installationCompleted ? purposeLabels.installation : booking.installationCompleted && !booking.programmingCompleted ? purposeLabels.programming : "Захиалгын одоогийн товлол"}</p>
    <h3>Үйлчилгээнд ирсэн түүх</h3>
    {loaded && !visits.length && <p>Ирэлт бүртгэгдээгүй.</p>}
    <ul className="service-visits">{visits.map(visit => <li key={visit.id}>
      <b>{local(visit.visitedAt)} · {purposeLabels[visit.purpose]}</b><p>{visit.branch} · {visit.note}</p><small>{visit.recordedBy.name} · {roles[visit.recordedBy.role]}</small>
      {editable && <div className="row-actions"><button disabled={busy} onClick={() => { setVisitId(visit.id); const at = visitDate(visit.visitedAt); setForm({ date: at.slice(0,10), time: at.slice(11,16), purpose: visit.purpose, branch: visit.branch, note: visit.note }); }}>Засах</button><button disabled={busy} onClick={() => { if (window.confirm("Ирэлтийг устгах уу?")) void mutate({ action: "visit.delete", visitId: visit.id }).then(ok => { if (ok && visitId === visit.id) { setVisitId(null); setForm(empty); } }); }}>Устгах</button></div>}
    </li>)}</ul>
    {editable && <form onSubmit={async e => { e.preventDefault(); if (await mutate({ action: visitId ? "visit.edit" : "visit.add", visitId, ...form })) { setVisitId(null); setForm(empty); } }}>
      <fieldset disabled={busy || !loaded} className="visit-fields"><legend>{visitId ? "Ирэлт засах" : "Ирэлт бүртгэх"}</legend>
        <label>Огноо<input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
        <label>Цаг<input required type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></label>
        <label>Зорилго<select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}>{Object.entries(purposeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Салбар<select value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })}>{["16-ын салбар", "Нарны замын салбар", "3-р салбар"].map(branch => <option key={branch}>{branch}</option>)}</select></label>
        <label>Тэмдэглэл<textarea maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        <button className="primary" type="submit">{busy ? "Хадгалж байна…" : "Хадгалах"}</button>
        {visitId && <button type="button" onClick={() => { setVisitId(null); setForm(empty); }}>Болих</button>}
      </fieldset>
    </form>}
  </dialog>;
}
