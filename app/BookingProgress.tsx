import type { ProcessState } from "./service-process";

export default function BookingProgress({ booking }: { booking: ProcessState }) {
  const programming = !!booking.programmingCompleted;
  const installation = !!booking.installationCompleted;
  const handover = !!booking.handoverCompleted;
  const incomplete = handover && (!programming || !installation);
  const percentage = Math.round((Number(programming) + Number(installation) + Number(handover)) / 3 * 100);
  const items = [
    { label: "Ирсэн", completed: !!booking.hasArrived },
    { label: "Программ", completed: programming },
    { label: "Төхөөрөмж", completed: installation },
    { label: "Хүлээлгэн өгсөн", completed: handover },
  ];

  return <div className={`booking-progress${incomplete ? " is-warning" : handover ? " is-handed-over" : ""}`}>
    <ul className="booking-progress-items" aria-label="Үйлчилгээний гүйцэтгэл">
      {items.map(({ label, completed }) => <li key={label} className={completed ? "is-complete" : ""} aria-label={`${label}: ${completed ? "дууссан" : "хүлээгдэж буй"}`}>
        <span className="booking-progress-circle" aria-hidden="true">{completed ? "✓" : ""}</span>
        <span>{label}</span>
      </li>)}
    </ul>
    {incomplete && <p className="booking-progress-warning">⚠ Хүлээлгэн өгсөн · үйлчилгээ дутуу</p>}
    <div className="booking-progress-meter">
      <span className="booking-progress-mobile-label">Явц</span>
      <div className="booking-progress-track" role="progressbar" aria-label="Үйлчилгээний явц" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}%${incomplete ? " · Хүлээлгэн өгсөн боловч үйлчилгээ дутуу" : ""}`}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <span className="booking-progress-percent">{percentage}%</span>
    </div>
  </div>;
}
