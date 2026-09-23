"use client";
import { useEffect, useRef, useState } from "react";
import { processStatus, processSteps, purposeLabels, type ActorSnapshot, type ProcessState } from "./service-process";

type Booking = ProcessState & { id: number; bookingNo: string; plate: string; vehicle?: string; manufactureYear?: number | null; branch: string; date: string; time: string };
type Visit = { id: number; visitedAt: string; purpose: keyof typeof purposeLabels; branch: string; note: string; recordedBy: ActorSnapshot };
const roles: Record<string, string> = { admin: "Админ", operator: "Захиалгын ажилтан", mechanic: "Механик" };
const local = (value: string) => new Date(value).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
function visitDate(value: string) { return new Date(new Date(value).getTime() + 8 * 3600000).toISOString(); }
export function ProcessBadge({ booking, compact = false }: { booking: ProcessState; compact?: boolean }) {
  const status = processStatus(booking);
  return <span className={`process-badge process-${status.color}`}>{compact ? status.label.split(" — ").at(-1) : status.label}</span>;
}
export default function ServiceProcess({ initial, editable, onClose, onUpdated }: { initial: Booking; editable: boolean; onClose: () => void; onUpdated: (booking: Booking) => void }) {
  const [booking, setBooking] = useState(initial), [visits, setVisits] = useState<Visit[]>([]);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [visitId, setVisitId] = useState<number | null>(null);
  const empty = { date: visitDate(new Date().toISOString()).slice(0,10), time: visitDate(new Date().toISOString()).slice(11,16), purpose: "programming", branch: initial.branch, note: "" };
  const [form, setForm] = useState(empty);
  const dialog = useRef<HTMLDialogElement>(null);
  const hasArrived = loaded ? visits.length > 0 : !!initial.hasArrived;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/bookings/${initial.id}/process`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setBooking({ ...data.booking, hasArrived: data.visits.length > 0 }); setVisits(data.visits); setLoaded(true);
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
      const updated = { ...data.booking, hasArrived: data.visits.length > 0 };
      setBooking(updated); setVisits(data.visits); onUpdated(updated); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Хадгалах боломжгүй."); return false; }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="service-dialog" aria-labelledby="service-process-title" onCancel={onClose}>
    <header className="service-header">
      <div className="service-heading"><h2 id="service-process-title">Үйлчилгээний явц</h2><button type="button" onClick={onClose} aria-label="Хаах"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
      <p className="service-identity">{booking.bookingNo} · {booking.plate}</p>
      {(booking.vehicle || booking.manufactureYear) && <p className="service-vehicle">{[booking.vehicle, booking.manufactureYear].filter(Boolean).join(" · ")}</p>}
    </header>
    <div className="service-status"><ProcessBadge booking={booking} compact /></div>
    {error && <p role="alert" className="error">{error}</p>}
    {!loaded && !error && <p role="status">Ачаалж байна…</p>}
    <fieldset disabled={!editable || busy || !loaded} className="process-steps"><legend>ЯВЦ</legend>
      <div className="process-item">
        <label className="process-row">
          <input type="checkbox" checked={hasArrived} disabled={hasArrived} onChange={() => setFormOpen(true)} />
          <span className={`process-check${hasArrived ? " is-complete" : ""}`} aria-hidden="true">{hasArrived ? "✓" : ""}</span><span>Ирсэн</span>
        </label>
      </div>
      {processSteps.map(step => {
        const actor = booking[`${step}CompletedBy`], at = booking[`${step}CompletedAt`], completed = !!booking[`${step}Completed`];
        const label = { programming: "Программ", installation: "Төхөөрөмж", handover: "Хүлээлгэн өгсөн" }[step];
        return <div className="process-item" key={step}>
          <label className="process-row">
            <input type="checkbox" checked={completed} onChange={e => void mutate({ action: "step", step, completed: e.target.checked })} />
            <span className={`process-check${completed ? " is-complete" : ""}`} aria-hidden="true">{completed ? "✓" : ""}</span><span>{label}</span>
          </label>
          {completed && at && <details className="process-metadata"><summary aria-label={`${label}: гүйцэтгэлийн мэдээлэл`}><time dateTime={at}>{visitDate(at).slice(5,10).replace("-", "/")}</time></summary><p>{local(at)} · {actor?.name} · {roles[actor?.role ?? ""] || actor?.role}</p></details>}
        </div>;
      })}
    </fieldset>
    {booking.handoverCompleted && (!booking.programmingCompleted || !booking.installationCompleted) && <p role="status">Анхаар: хүлээлгэн өгсөн боловч үйлчилгээ бүрэн дуусаагүй.</p>}
    <section className="service-appointment" aria-label="Дараагийн товлол">
      <h3>Дараагийн товлол</h3>
      <p className="service-appointment-time">{booking.date.slice(5).replace("-", "/")} · {booking.time}</p>
      <p>{booking.branch}</p>
      {booking.programmingCompleted && !booking.installationCompleted ? <p className="service-secondary">{purposeLabels.installation}</p> : booking.installationCompleted && !booking.programmingCompleted ? <p className="service-secondary">{purposeLabels.programming}</p> : null}
    </section>
    {editable && !formOpen && <button type="button" className="soft service-add-visit" disabled={busy || !loaded} onClick={() => setFormOpen(true)}>+ Ирэлт бүртгэх</button>}
    {editable && formOpen && <form onSubmit={async e => { e.preventDefault(); if (await mutate({ action: visitId ? "visit.edit" : "visit.add", visitId, ...form })) { setVisitId(null); setForm(empty); setFormOpen(false); } }}>
      <fieldset disabled={busy || !loaded} className="visit-fields"><legend>{visitId ? "Ирэлт засах" : "Ирэлт бүртгэх"}</legend>
        <label>Огноо<input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
        <label>Цаг<input required type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></label>
        <label>Зорилго<select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}>{Object.entries(purposeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Салбар<select value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })}>{["16-ын салбар", "Нарны замын салбар", "3-р салбар"].map(branch => <option key={branch}>{branch}</option>)}</select></label>
        <label className="visit-note">Тэмдэглэл<textarea maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        <div className="visit-form-actions"><button className="primary" type="submit">{busy ? "Хадгалж байна…" : "Хадгалах"}</button>
        <button className="cancel" type="button" onClick={() => { setVisitId(null); setForm(empty); setFormOpen(false); }}>Болих</button></div>
      </fieldset>
    </form>}
    <details className="service-history">
      <summary>Ирэлтийн түүх ({loaded ? visits.length : "…"})<span aria-hidden="true">›</span></summary>
      {loaded && !visits.length && <p className="service-secondary">Ирэлт бүртгэгдээгүй.</p>}
      <ul className="service-visits">{visits.map(visit => <li key={visit.id}>
        <b>{purposeLabels[visit.purpose]}</b><p>{local(visit.visitedAt)}</p><p>{visit.branch}{visit.note && ` · ${visit.note}`}</p><small>{visit.recordedBy.name} · {roles[visit.recordedBy.role]}</small>
        {editable && <div className="row-actions"><button disabled={busy} onClick={() => { setVisitId(visit.id); setFormOpen(true); const at = visitDate(visit.visitedAt); setForm({ date: at.slice(0,10), time: at.slice(11,16), purpose: visit.purpose, branch: visit.branch, note: visit.note }); }}>Засах</button><button className="delete" disabled={busy} onClick={() => { if (window.confirm("Ирэлтийг устгах уу?")) void mutate({ action: "visit.delete", visitId: visit.id }).then(ok => { if (ok && visitId === visit.id) { setVisitId(null); setForm(empty); setFormOpen(false); } }); }}>Устгах</button></div>}
      </li>)}</ul>
    </details>
  </dialog>;
}
