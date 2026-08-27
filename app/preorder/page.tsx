"use client";

import { useEffect, useState } from "react";

const MAX_LENGTHS = {
  customer: 120,
  phone: 40,
  vehicle: 120,
  plate: 40,
  note: 500,
};

export default function PreorderPage() {
  const [form, setForm] = useState({ customer: "", phone: "", vehicle: "", plate: "", note: "" });
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const allowed = new Set(["manual", "facebook", "website"]);
    const source = params.get("source");
    if (source && allowed.has(source)) {
      setForm((current) => ({ ...current, note: current.note || `source:${source}` }));
    }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const body = {
      customer: form.customer.trim(),
      phone: form.phone.trim(),
      vehicle: form.vehicle.trim(),
      plate: form.plate.trim(),
      note: form.note.trim(),
      honeypot: "",
    };

    if (!body.customer || !body.phone || !body.vehicle) {
      setMessage("Нэр, утас, автомашины марк/модель заавал бөглөх шаардлагатай.");
      setBusy(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const source = params.get("source") || "website";
    const response = await fetch(`/api/preorder?source=${encodeURIComponent(source)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || "Урьдчилсан захиалга илгээх боломжгүй байна.");
      return;
    }

    setOk(true);
    setMessage("Таны урьдчилсан захиалга амжилттай бүртгэгдлээ. Манай ажилтан тантай холбогдох болно.");
    setForm({ customer: "", phone: "", vehicle: "", plate: "", note: "" });
  }

  return (
    <main className="preorder-page-shell">
      <section className="preorder-card">
        <div className="preorder-brand">
          <span className="brand-mark">G</span>
          <div>
            <strong>Грийн Энжин</strong>
            <small>Газ сервис</small>
          </div>
        </div>

        <p className="eyebrow">УРЬДЧИЛСАН ЗАХИАЛГА</p>
        <h1>Бүртгэлээ үлдээгээрэй</h1>
        <p className="preorder-subtitle">Таны автомашины үйлчилгээний талаар бид тантай холбогдоно.</p>

        <form onSubmit={submit} className="preorder-form">
          <label>
            Нэр
            <input
              required
              maxLength={MAX_LENGTHS.customer}
              value={form.customer}
              onChange={(event) => setForm((current) => ({ ...current, customer: event.target.value }))}
              placeholder="Таны нэр"
            />
          </label>

          <label>
            Утасны дугаар
            <input
              required
              maxLength={MAX_LENGTHS.phone}
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="99112233"
            />
          </label>

          <label>
            Автомашины марк / модель
            <input
              required
              maxLength={MAX_LENGTHS.vehicle}
              value={form.vehicle}
              onChange={(event) => setForm((current) => ({ ...current, vehicle: event.target.value }))}
              placeholder="Toyota Prius"
            />
          </label>

          <label>
            Улсын дугаар (optional)
            <input
              maxLength={MAX_LENGTHS.plate}
              value={form.plate}
              onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value }))}
              placeholder="УБ 1234"
            />
          </label>

          <label>
            Нэмэлт мэдээлэл (optional)
            <textarea
              maxLength={MAX_LENGTHS.note}
              rows={4}
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              placeholder="Нэмэлт тайлбар…"
            />
          </label>

          <button className="preorder-submit" type="submit" disabled={busy}>
            {busy ? "Илгээж байна..." : "Урьдчилсан захиалга илгээх"}
          </button>
        </form>

        {message && <div className={ok ? "preorder-message success" : "preorder-message error"}>{message}</div>}
      </section>
    </main>
  );
}
