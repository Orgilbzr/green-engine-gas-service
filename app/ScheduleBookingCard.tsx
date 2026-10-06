type Props = {
  booking: { time: string; plate: string; vehicle: string; phone?: string | null };
  canEdit: boolean;
  onAction: () => void;
};

export default function ScheduleBookingCard({ booking, canEdit, onAction }: Props) {
  const phone = booking.phone?.trim();
  const action = canEdit ? "Хуваарь өөрчлөх" : "Үйлчилгээний явц";
  return (
    <div className="day-booked">
      <span className="schedule-time">{booking.time}</span>
      <strong className="schedule-plate">{booking.plate}</strong>
      <span className="schedule-vehicle" title={booking.vehicle}>{booking.vehicle}</span>
      {phone && (
        <a className="schedule-phone" href={`tel:${phone}`} aria-label={`${phone} руу залгах`}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 1.7L8.7 10.5a16 16 0 0 0 4.8 4.8l1.3-1.3a2 2 0 0 1 1.7-.6l2.8.5a2 2 0 0 1 1.7 2Z" />
          </svg>
          {phone}
        </a>
      )}
      <button type="button" className="schedule-action" onClick={onAction} aria-label={`${booking.plate}: ${action}`}>
        {action}
      </button>
    </div>
  );
}
