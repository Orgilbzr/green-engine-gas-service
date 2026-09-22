"use client";
import { useId, useRef, useState } from "react";
import { paymentFilters, serviceFilterGroups, serviceFilters, type PaymentFilter, type ServiceFilter } from "./booking-filters";

type Props = {
  search: string; onSearch: (value: string) => void;
  service: ServiceFilter; onService: (value: ServiceFilter) => void;
  payment: PaymentFilter; onPayment: (value: PaymentFilter) => void;
  count: number; loadedCount: number;
};
export default function BookingFilters({ search, onSearch, service, onService, payment, onPayment, count, loadedCount }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const active = Number(!!service) + Number(!!payment);
  return <div className="booking-filter-controls" onKeyDown={event => {
    if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); }
  }}>
    <div className="booking-search-row">
      <input aria-label="Хайх" value={search} onChange={e => onSearch(e.target.value)} placeholder="Нэр, утас, улсын дугаар…" />
      <button ref={trigger} type="button" className="soft" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>Шүүлтүүр{active ? ` (${active})` : ""}</button>
    </div>
    {open && <div id={menuId} className="booking-filter-menu">
      <label>Үйлчилгээ<select value={service} onChange={e => onService(e.target.value as ServiceFilter)}>
        <option value="">Бүх үйлчилгээ</option>
        {serviceFilterGroups.map(group => <optgroup key={group.label} label={group.label}>
          {group.options.map(value => <option key={value} value={value}>{serviceFilters[value]}</option>)}
        </optgroup>)}
      </select></label>
      <label>Төлбөр<select value={payment} onChange={e => onPayment(e.target.value as PaymentFilter)}>
        <option value="">Бүх төлбөр</option>
        {Object.entries(paymentFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>}
    <div className="booking-filter-summary">
      {service && <button type="button" className="booking-filter-chip" aria-label={`${serviceFilters[service]} шүүлтүүрийг арилгах`} onClick={() => onService("")}>{serviceFilters[service]} <span aria-hidden="true">×</span></button>}
      {payment && <button type="button" className="booking-filter-chip" aria-label={`${paymentFilters[payment]} шүүлтүүрийг арилгах`} onClick={() => onPayment("")}>{paymentFilters[payment]} <span aria-hidden="true">×</span></button>}
      {active > 0 && <button type="button" className="booking-filter-clear" onClick={() => { onService(""); onPayment(""); }}>Бүгдийг арилгах</button>}
      <span className="booking-filter-count" role="status">{count} захиалга</span>
    </div>
    {loadedCount >= 500 && <p className="booking-filter-scope">Ачаалагдсан {loadedCount} захиалга дотроос хайж, шүүнэ.</p>}
  </div>;
}
