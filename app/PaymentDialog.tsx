"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { balance } from "./dashboard-metrics";
import "./payment.css";

type PaymentBooking = { id: number; bookingNo: string; totalPrice?: number; advance?: number; finalPaid?: number };
const currency = (amount: number) => `${new Intl.NumberFormat("en-US").format(amount)}₮`;

export default function PaymentDialog({ booking, onClose, onPaid }: {
  booking: PaymentBooking; onClose: () => void; onPaid: (booking: PaymentBooking) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const request = useRef<{ amount: number; key: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = balance(booking);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const paymentAmount = /^\d+$/.test(amount) ? Number(amount) : NaN;
    if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0) {
      setError("Төлөх дүнг 0-ээс их бүхэл төгрөгөөр оруулна уу."); return;
    }
    if (paymentAmount > remaining) {
      setError("Төлөх дүн үлдэгдлээс их байж болохгүй."); return;
    }
    submitting.current = true; setBusy(true); setError("");
    try {
      // Retain the key when retrying the same amount after an uncertain response.
      if (request.current?.amount !== paymentAmount) request.current = { amount: paymentAmount, key: crypto.randomUUID() };
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH", headers: { "content-type": "application/json", "Idempotency-Key": request.current.key },
        body: JSON.stringify({ paymentAmount }),
      });
      const data = await response.json() as { booking?: PaymentBooking; error?: string };
      if (!response.ok || !data.booking) throw new Error(data.error || "Төлбөр бүртгэх боломжгүй.");
      onPaid(data.booking); onClose();
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Сервертэй холбогдож чадсангүй. Ижил дүнгээр дахин оролдоно уу.");
    } finally {
      submitting.current = false; setBusy(false);
    }
  }

  return <dialog ref={dialogRef} className="modal payment-dialog" aria-labelledby="payment-title"
    onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <form onSubmit={submit} noValidate>
      <h2 id="payment-title">Төлбөр авах</h2>
      <p className="modal-copy">{booking.bookingNo}</p>
      <dl className="payment-summary">
        <div><dt>Нийт үнэ</dt><dd>{currency(booking.totalPrice || 0)}</dd></div>
        <div><dt>Төлсөн</dt><dd>{currency((booking.advance || 0) + (booking.finalPaid || 0))}</dd></div>
        <div><dt>Үлдэгдэл</dt><dd>{currency(remaining)}</dd></div>
      </dl>
      <label htmlFor="payment-amount">Төлөх дүн (₮)</label>
      <input id="payment-amount" type="number" inputMode="numeric" step="1" min="1" max={remaining} autoFocus required
        value={amount} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "payment-error" : undefined}
        onChange={event => { setAmount(event.target.value); setError(""); }} />
      <button type="button" className="payment-balance-shortcut" disabled={busy || remaining <= 0} onClick={() => { setAmount(String(remaining)); setError(""); }}>Бүх үлдэгдэл: {currency(remaining)}</button>
      {error && <p id="payment-error" className="payment-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="cancel" disabled={busy} onClick={() => { if (!submitting.current) onClose(); }}>Болих</button>
        <button type="submit" className="primary" disabled={busy || remaining <= 0}>{busy ? "Бүртгэж байна..." : "Төлбөр бүртгэх"}</button>
      </div>
    </form>
  </dialog>;
}
