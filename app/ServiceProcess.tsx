"use client";
import { useEffect, useRef, useState } from "react";
import { formatProcessTimestamp, processStatus, processSteps, type ActorSnapshot, type ProcessState } from "./service-process";

type Booking = ProcessState & { id: number; bookingNo: string; plate: string; vehicle?: string; manufactureYear?: number | null; branch: string; date: string; time: string };
const roles: Record<string, string> = { admin: "Админ", operator: "Захиалгын ажилтан", mechanic: "Механик" };
const local = (value: string) => new Date(value).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
const revertLabels = { programming: "Программ уншуулсныг буцаах уу?", installation: "Төхөөрөмж суурилуулсныг буцаах уу?", handover: "Хүлээлгэн өгснийг буцаах уу?" };
function StepTime({ at, actor }: { at: string; actor?: ActorSnapshot | null }) {
  return <time className="process-timestamp" dateTime={at} title={`${local(at)}${actor ? ` · ${actor.name} · ${roles[actor.role] || actor.role}` : ""}`}>{formatProcessTimestamp(at)}</time>;
}
export function ProcessBadge({ booking, compact = false }: { booking: ProcessState; compact?: boolean }) {
  const status = processStatus(booking);
  return <span className={`process-badge process-${status.color}`}>{compact ? status.label.split(" — ").at(-1) : status.label}</span>;
}
export default function ServiceProcess({ initial, editable, onClose, onUpdated }: { initial: Booking; editable: boolean; onClose: () => void; onUpdated: (booking: Booking) => void }) {
  const [booking, setBooking] = useState(initial);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const hasArrived = !!booking.hasArrived;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/bookings/${initial.id}/process`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setBooking(data.booking); setLoaded(true);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [initial.id]);
  async function mutate(payload: Record<string, unknown>) {
    if (!editable || !loaded || saving.current) return false;
    saving.current = true;
    setBusy(true); setError("");
    try {
      const send = (body: Record<string, unknown>) => fetch(`/api/bookings/${booking.id}/process`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let response = await send(payload), data = await response.json();
      if (data.requiresConfirmation) {
        if (!window.confirm(data.error)) return false;
        response = await send({ ...payload, confirmIncomplete: true }); data = await response.json();
      }
      if (!response.ok) throw new Error(data.error || "Хадгалах боломжгүй.");
      setBooking(data.booking); onUpdated(data.booking); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Хадгалах боломжгүй."); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="service-dialog" aria-labelledby="service-process-title" onCancel={onClose}>
    <header className="service-header">
      <div className="service-heading"><h2 id="service-process-title">Үйлчилгээний явц</h2><button type="button" onClick={onClose} aria-label="Хаах"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
      <p className="service-identity">{booking.bookingNo} · {booking.plate}</p>
      {(booking.vehicle || booking.manufactureYear) && <p className="service-vehicle">{[booking.vehicle, booking.manufactureYear].filter(Boolean).join(" · ")}</p>}
    </header>
    {error && <p role="alert" className="error">{error}</p>}
    {!loaded && !error && <p role="status">Ачаалж байна…</p>}
    <fieldset disabled={!editable || busy || !loaded} className="process-steps"><legend>ЯВЦ</legend>
      <div className="process-item">
        <label className="process-row">
          <input type="checkbox" checked={hasArrived} disabled={hasArrived} onChange={() => void mutate({ action: "arrival" })} />
          <span className={`process-check${hasArrived ? " is-complete" : ""}`} aria-hidden="true">{hasArrived ? "✓" : ""}</span><span>Ирсэн</span>
        </label>
        {hasArrived && booking.arrivedAt && <StepTime at={booking.arrivedAt} actor={booking.arrivedBy} />}
      </div>
      {processSteps.map(step => {
        const actor = booking[`${step}CompletedBy`], at = booking[`${step}CompletedAt`], completed = !!booking[`${step}Completed`];
        const label = { programming: "Программ", installation: "Төхөөрөмж", handover: "Хүлээлгэн өгсөн" }[step];
        return <div className="process-item" key={step}>
          <label className="process-row">
            <input type="checkbox" checked={completed} onChange={() => { if (!editable || !loaded || busy || saving.current) return; if (!completed || window.confirm(revertLabels[step])) void mutate({ action: "step", step, completed: !completed }); }} />
            <span className={`process-check${completed ? " is-complete" : ""}`} aria-hidden="true">{completed ? "✓" : ""}</span><span>{label}</span>
          </label>
          {completed && at && <StepTime at={at} actor={actor} />}
        </div>;
      })}
    </fieldset>
  </dialog>;
}
