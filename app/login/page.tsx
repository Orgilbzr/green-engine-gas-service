"use client";

import { useState } from "react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const result = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setMessage(result.error || "Алдаа гарлаа."); return; }
    window.location.replace("/");
  }

  return <main className="login-page"><section className="login-card"><div className="login-mark">G</div><p className="eyebrow">ГРИЙН ЭНЖИН ГАЗ СЕРВИС</p><h1>Захиалгын системд нэвтрэх</h1><p>Бүртгэлтэй имэйл болон password-оо оруулна уу.</p><form onSubmit={submit}><label>Имэйл хаяг<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@email.com" /></label><label>Password<input type="password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" /></label><button className="login-button" disabled={busy}>{busy ? "Нэвтэрч байна..." : "Нэвтрэх"}</button></form>{message && <small>{message}</small>}<small>Password хамгийн багадаа 8 тэмдэгт байна.</small></section></main>;
}
