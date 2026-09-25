// This covers evidence available on a loaded booking. The DELETE route also checks
// related rows and audit history inside its transaction.
export type BookingDeleteCandidate = {
  status?: string | null;
  programmingCompleted?: boolean | null;
  installationCompleted?: boolean | null;
  handoverCompleted?: boolean | null;
  programmingCompletedAt?: Date | string | null;
  installationCompletedAt?: Date | string | null;
  handoverCompletedAt?: Date | string | null;
  programmingCompletedBy?: unknown;
  installationCompletedBy?: unknown;
  handoverCompletedBy?: unknown;
  advance?: number | null;
  finalPaid?: number | null;
  receipt?: string | null;
  advanceType?: string | null;
  advanceNote?: string | null;
  noteCount?: number | null;
  hasArrived?: boolean | null;
};

export function hasBookingDeleteEvidence(booking: BookingDeleteCandidate): boolean {
  return booking.status != null && !["Хүлээгдэж буй", "Баталгаажсан"].includes(booking.status)
    || booking.hasArrived === true
    || booking.programmingCompleted !== false && booking.programmingCompleted != null
    || booking.installationCompleted !== false && booking.installationCompleted != null
    || booking.handoverCompleted !== false && booking.handoverCompleted != null
    || booking.programmingCompletedAt != null || booking.installationCompletedAt != null || booking.handoverCompletedAt != null
    || booking.programmingCompletedBy != null || booking.installationCompletedBy != null || booking.handoverCompletedBy != null
    || booking.advance == null || booking.advance !== 0
    || booking.finalPaid == null || booking.finalPaid !== 0
    || Boolean(booking.receipt?.trim()) || Boolean(booking.advanceType?.trim()) || Boolean(booking.advanceNote?.trim())
    || (booking.noteCount != null && booking.noteCount > 0);
}
