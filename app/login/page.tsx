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
    if (busy) return;
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      console.info("[api-client]", { route: "/api/auth/login", phase: "start" });
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "cache-control": "no-cache" }, body: JSON.stringify({ email, password }), signal: controller.signal, cache: "no-store" });
      console.info("[api-client]", { route: "/api/auth/login", phase: "response", status: response.status });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setMessage(result.error || "Имэйл эсвэл password буруу байна."); return; }
      window.location.replace("/");
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      console.warn("[api-client]", { route: "/api/auth/login", phase: "error", name });
      setMessage(name === "AbortError" ? "Хүсэлт хэт удаж байна. Дахин оролдоно уу." : "Сервертэй холбогдож чадсангүй. Дахин оролдоно уу.");
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  return <main className="login-page"><section className="login-card"><div className="login-mark">G</div><p className="eyebrow">ГРИЙН ЭНЖИН ГАЗ СЕРВИС</p><h1>Захиалгын системд нэвтрэх</h1><p>Бүртгэлтэй имэйл болон password-оо оруулна уу.</p><form onSubmit={submit}><label>Имэйл хаяг<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@email.com" /></label><label>Password<input type="password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" /></label><button className="login-button" disabled={busy}>{busy ? "Нэвтэрч байна..." : "Нэвтрэх"}</button></form>{message && <small>{message}</small>}<small>Password хамгийн багадаа 8 тэмдэгт байна.</small></section></main>;
}
