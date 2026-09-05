"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { defaultReportFilters, paymentOptions, reportCurrency, reportQuery, reportStatuses, sourceLabel, sourceOptions, type ReportData, type ReportFilters, type ReportRow } from "./model";

type LoadState = { status: "idle" | "loading" | "loaded" | "error"; key: string; data?: ReportData; error?: string };
const kpis = [["count", "Нийт захиалга"], ["sales", "Нийт борлуулалт"], ["advance", "Нийт урьдчилгаа"], ["remaining", "Нийт үлдэгдэл"], ["completed", "Дууссан"], ["cancelled", "Цуцлагдсан"]] as const;
const headings = ["Захиалга №", "Огноо", "Салбар", "Үйлчлүүлэгч", "Утас", "Улсын дугаар", "Автомашин", "Үйлдвэрлэсэн он", "Бүтээгдэхүүн", "Нийт үнэ", "Урьдчилгаа", "Үлдэгдэл", "Төлөв", "Эх сурвалж"];

export default function ReportsView({ active }: { active: boolean }) {
  const [draft, setDraft] = useState(defaultReportFilters);
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle", key: "" });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportController = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const query = reportQuery(applied).toString();
  const key = `${query}&page=${page}&revision=${revision}`;
  const ready = state.status === "loaded" && state.key === key;
  const failed = state.status === "error" && state.key === key;
  const data = ready ? state.data : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let current = true;
    // A new network request must replace cached results with the independent loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(previous => ({ status: "loading", key, data: previous.data }));
    fetch(`/api/reports?${query}&page=${page}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Тайланг ачаалж чадсангүй.");
        if (current) setState({ status: "loaded", key, data: body as ReportData });
      })
      .catch(error => {
        if (current) setState(previous => ({ status: "error", key, data: previous.data, error: controller.signal.aborted ? "Хүлээлгийн хугацаа дууслаа. Дахин оролдоно уу." : error.message }));
      })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [active, key, query, page]);

  useEffect(() => () => { exportController.current?.abort(); }, [active]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setApplied({ ...draft }); setPage(1); setRevision(value => value + 1); setFiltersOpen(false); setExportError("");
  }
  function clear() {
    const defaults = defaultReportFilters();
    setDraft(defaults); setApplied(defaults); setPage(1); setRevision(value => value + 1); setExportError("");
  }
  function update(name: keyof ReportFilters, value: string) {
    setDraft(previous => ({ ...previous, [name]: value }));
  }
  async function download() {
    if (!ready || exporting || dirty) return;
    const controller = new AbortController();
    exportController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60000);
    setExporting(true); setExportError("");
    try {
      const response = await fetch(`/api/reports?${query}&format=xlsx`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Excel файл үүсгэж чадсангүй.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `green-engine-report-${applied.from}-${applied.to}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(controller.signal.aborted ? "Excel татах хүсэлт зогслоо. Дахин оролдоно уу." : error instanceof Error ? error.message : "Excel файл үүсгэж чадсангүй.");
    } finally {
      clearTimeout(timeout); setExporting(false); exportController.current = null;
    }
  }
  const options = state.data?.options;
  return <section className="reports-view" hidden={!active} aria-label="Удирдлагын тайлан">
    <div className="report-toolbar">
      <div><h2>Захиалгын тайлан</h2><p>{applied.from} — {applied.to} · Захиалгын огноогоор</p></div>
      <button type="button" className="primary report-export" disabled={!ready || exporting || dirty} onClick={download}>{exporting ? "Excel бэлтгэж байна..." : "Excel татах"}</button>
    </div>
    <div className="panel report-filter-panel">
      <button type="button" className="report-filter-toggle" aria-expanded={filtersOpen} aria-controls="report-filters" onClick={() => setFiltersOpen(value => !value)}>Шүүлтүүр {filtersOpen ? "−" : "+"}</button>
      <form id="report-filters" className={`report-filters${filtersOpen ? " is-open" : ""}`} onSubmit={apply}>
        <label>Эхлэх огноо<input type="date" required min="1900-01-01" max={draft.to || undefined} value={draft.from} onChange={event => update("from", event.target.value)} /></label>
        <label>Дуусах огноо<input type="date" required min={draft.from || "1900-01-01"} value={draft.to} onChange={event => update("to", event.target.value)} /></label>
        <label>Салбар<select value={draft.branch} onChange={event => update("branch", event.target.value)}><option value="">Бүх салбар</option>{options?.branches.map(branch => <option key={branch}>{branch}</option>)}</select></label>
        <label>Захиалгын төлөв<select value={draft.status} onChange={event => update("status", event.target.value)}><option value="">Бүх төлөв</option>{reportStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
        <label>Бүтээгдэхүүн<select value={draft.productId} onChange={event => update("productId", event.target.value)}><option value="">Бүх бүтээгдэхүүн</option>{options?.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label>Төлбөрийн төлөв<select value={draft.paymentStatus} onChange={event => update("paymentStatus", event.target.value)}>{paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Эх сурвалж<select value={draft.source} onChange={event => update("source", event.target.value)}>{sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Хайлт<input type="search" maxLength={100} placeholder="Захиалга №, нэр, утас, улсын дугаар" value={draft.search} onChange={event => update("search", event.target.value)} /></label>
        <div className="report-filter-actions"><button className="primary" type="submit">Шүүх</button><button className="soft" type="button" onClick={clear}>Цэвэрлэх</button>{dirty && <span role="status">Шүүлтүүрийг хэрэгжүүлэхийн тулд «Шүүх» дарна уу.</span>}</div>
      </form>
    </div>
    {exportError && <p className="report-error" role="alert">{exportError}</p>}
    <div ref={resultsRef} className="report-results" aria-busy={!ready && !failed}>
      {failed ? <div className="panel report-error" role="alert"><p>{state.error}</p><button className="soft" onClick={() => setRevision(value => value + 1)}>Дахин оролдох</button></div> : <>
        <div className="report-kpis" aria-label="Тайлангийн үзүүлэлтүүд">
          {kpis.map(([name, label]) => <article className="report-kpi" key={name}><p>{label}</p>{data ? <strong>{["sales", "advance", "remaining"].includes(name) ? reportCurrency(data.totals[name]) : data.totals[name]}</strong> : <span className="report-skeleton" aria-hidden="true" />}</article>)}
        </div>
        {!data ? <div className="panel report-loading" role="status"><span>Тайлан ачаалж байна...</span>{[0, 1, 2, 3].map(index => <div key={index} className="report-skeleton" />)}</div> : <>
          <p className="report-note">Бүх дүн сонгосон шүүлтүүрт таарсан {data.totals.count} захиалгад хамаарна. Үлдэгдэлд эцсийн төлбөрийг тооцсон. Цуцлагдсан захиалга шүүлтүүрт орсон бол дүнд багтана.</p>
          {data.totals.count === 0 ? <div className="panel empty">Сонгосон шүүлтүүрт тохирох захиалга алга.</div> : <>
            <div className="panel report-table-wrap" tabIndex={0} role="region" aria-label="Захиалгын дэлгэрэнгүй хүснэгт">
              <table className="report-table"><thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.id}>
                <td><b>{row.bookingNo}</b></td><td>{row.date}</td><td>{row.branch}</td><td>{row.customer}</td><td>{row.phone}</td><td>{row.plate}</td><td>{row.vehicle}</td><td>{row.manufactureYear ?? "—"}</td><td>{row.productName}</td>
                <td className="report-money">{reportCurrency(row.totalPrice)}</td><td className="report-money">{reportCurrency(row.advance)}</td><td className="report-money">{reportCurrency(row.remaining)}</td><td><ReportStatus row={row} /></td><td>{sourceLabel(row.source)}</td>
              </tr>)}</tbody></table>
            </div>
            <div className="report-cards">{data.rows.map(row => <article key={row.id} className="panel report-card">
              <div className="report-card-heading"><strong>{row.bookingNo}</strong><ReportStatus row={row} /></div>
              <p className="report-card-date">{row.date} · {row.branch}</p><h3>{row.customer} · {row.plate}</h3><p>{row.productName}</p>
              <dl>{[["Нийт үнэ", row.totalPrice], ["Урьдчилгаа", row.advance], ["Үлдэгдэл", row.remaining]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{reportCurrency(Number(value))}</dd></div>)}</dl>
            </article>)}</div>
            <div className="report-pagination"><span>{(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.totals.count)} / {data.totals.count} захиалга</span><div><button className="soft" disabled={page === 1} onClick={() => { setPage(value => value - 1); resultsRef.current?.scrollIntoView({ block: "start" }); }}>Өмнөх</button><button className="soft" disabled={page * data.pageSize >= data.totals.count} onClick={() => { setPage(value => value + 1); resultsRef.current?.scrollIntoView({ block: "start" }); }}>Дараах</button></div></div>
          </>}
        </>}
      </>}
    </div>
  </section>;
}
function ReportStatus({ row }: { row: ReportRow }) {
  return <span className={`report-status${row.status === "Цуцлагдсан" ? " is-cancelled" : row.status === "Дууссан" ? " is-completed" : ""}`}>{row.status}</span>;
}
