"use client";
import { useEffect, useRef, useState } from "react";
import { noteDate, type HistoryNote, type NoteSummary, type NoteTarget } from "./note-history";

export function NotePreview({ summary, editable, onOpen }: { summary: Partial<NoteSummary>; editable: boolean; onOpen: () => void }) {
  const hasNote = !!summary.latestNote;
  const priorCount = Math.max((summary.noteCount ?? 0) - 1, 0);
  return <button type="button" className="note-preview" onClick={onOpen} aria-label="Тэмдэглэлийн түүх нээх">
    {hasNote ? <>
      <span className="note-preview-row">
        <span className="note-preview-icon" aria-hidden="true">📝</span>
        <span className="note-preview-text">{summary.latestNote}</span>
      </span>
      {priorCount > 0 && <b className="note-preview-count">+{priorCount} өмнөх тэмдэглэл</b>}
    </> : <span className="note-preview-empty">{editable ? "+ Тэмдэглэл" : "Тэмдэглэлгүй"}</span>}
  </button>;
}
export function NoteTimeline({ notes }: { notes: HistoryNote[] }) {
  return notes.length ? <ol className="note-timeline">{notes.map(note => <li key={note.id}>
    <div className="note-metadata">{note.legacy ? <span>Өмнөх тэмдэглэл · бичсэн огноо тодорхойгүй</span> : <time dateTime={note.createdAt}>{noteDate(note.createdAt)}</time>}<span>{note.createdBy.name}</span></div>
    <p>{note.note}</p>
  </li>)}</ol> : <p className="note-empty">Одоогоор тэмдэглэл алга.</p>;
}
export default function NoteHistory({ target, editable, onClose, onUpdated }: { target: NoteTarget; editable: boolean; onClose: () => void; onUpdated: (summary: NoteSummary) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [notes, setNotes] = useState<HistoryNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const url = `/api/${target.kind}/${target.id}/notes`;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    fetch(url, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Тэмдэглэл ачаалах боломжгүй.");
      if (active) { setNotes(data.notes); setLoaded(true); setError(""); }
    }).catch(() => { if (active) setError("Тэмдэглэл ачаалах боломжгүй. Дахин оролдоно уу."); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [url, retry]);
  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!editable || !loaded || submitting.current || !draft.trim()) return;
    submitting.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: draft.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Тэмдэглэл хадгалах боломжгүй.");
      const updated = data.notes as HistoryNote[];
      setNotes(updated); setDraft("");
      onUpdated({ noteCount: updated.length, latestNote: updated[0]?.note ?? null });
    } catch (cause) { setError(cause instanceof DOMException && cause.name === "AbortError" ? "Холболт тасарлаа. Дахин нэмэхээс өмнө түүхийг хааж нээгээд хадгалагдсан эсэхийг шалгана уу." : cause instanceof Error ? cause.message : "Тэмдэглэл хадгалах боломжгүй."); }
    finally { clearTimeout(timeout); submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="note-dialog" aria-labelledby="note-history-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <header><div><h2 id="note-history-title">Тэмдэглэлийн түүх</h2><p>{target.label}</p></div><button type="button" className="soft" aria-label="Хаах" disabled={busy} onClick={onClose}>×</button></header>
    <section className="note-history-body" aria-busy={!loaded}>
      {!loaded && !error && <p role="status">Ачаалж байна…</p>}
      {loaded && <NoteTimeline notes={notes} />}
      {error && <p role="alert" className="error">{error}</p>}
      {!loaded && error && <button className="soft" onClick={() => setRetry(value => value + 1)}>Дахин оролдох</button>}
    </section>
    {editable ? <form onSubmit={addNote} className="note-compose">
      <label htmlFor="new-note">Шинэ тэмдэглэл</label>
      <textarea id="new-note" placeholder="Шинэ тэмдэглэл бичих..." maxLength={2000} rows={3} required disabled={busy || !loaded} value={draft} onChange={event => setDraft(event.target.value)} />
      <button className="primary" type="submit" disabled={busy || !loaded || !draft.trim()}>{busy ? "Хадгалж байна…" : "Тэмдэглэл нэмэх"}</button>
    </form> : <p className="note-readonly">Зөвхөн харах эрхтэй.</p>}
  </dialog>;
}
