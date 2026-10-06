# Advance investigation at 917e4ef

No production root cause is confirmed: this checkout has no usable DATABASE_URL.
A read-only connection attempt was not made because credentials were absent.
The supplied screenshot example is not a database observation.
No application fix, formula change, historical repair or deployment is justified yet.

## Trace of the current implementation

- New booking: `form.advance` is a numeric-input string. `submit` serializes the
  complete form, including `advance`. Validation `money` converts an integer
  numeric string to a number. POST inserts `body.advance ?? 0` into `bookings.advance`.
  `total_price` comes from the selected product; `final_paid` starts at zero.
- Conversion: pre_bookings has no advance/deposit storage field. The shared new
  booking form accepts a new advance. Its payload goes to POST preorders/[id].
  Validation retains it; insertion uses `Math.min(product.price, body.advance ?? 0)`.
  Product/customer/vehicle are copied from the form; year comes from the preorder;
  source stays on the original preorder and report derives it by converted_booking_id.
  Conversion atomically updates lineage/status and inserts the booking.
- Edit: PATCH constructs an explicit values object. It does not assign advance.
  A missing advance cannot reset existing data to the schema default.
- Payment: paymentAmount increments cumulative finalPaid under a row lock, with
  an idempotency key. advance stays the original creation-time advance.
- Report: row `advance` is directly selected from bookings.advance; KPI and branch
  summaries use SUM(advance). Raw balance is GREATEST(0,total_price-advance-final_paid).
  Cancelled/returned rows keep their advance but are excluded from sales/collectible
  balance according to existing eligibility rules.
- ReportsView and Excel both use row.advance and totals.advance directly. There is
  no advancePayment/prepayment/advance_payment alias in this write/read path.

## Confirmed isolated regression evidence

The actual creation/conversion/PATCH handlers, PostgreSQL schema, report SQL and
Excel generator are exercised together in service-regression.test.mjs:
5m total / 1m advance -> stored/report 1m, balance 4m; unrelated edit retains 1m;
2m subsequent payment -> final_paid 2m, balance 2m, advance still 1m.
Conversion with 1m retains it; omitted conversion advance yields zero intentionally.
Excel numeric cells and KPI/branch sums reconcile. Existing report tests cover
cancelled/returned semantics without changing them.

## Historical limits and next evidence

Run sql/report_advance_readonly_audit.sql only with an authorized read-only
production connection. Confirm the connection is the database used by the live
production deployment, and reproduce the screenshot's exact filters.
If GE-261005-000066 has total=5m, advance=0 and final_paid=0, its reported 5m raw
balance is mathematically correct. This would rule out report mapping as the cause
for that row, but would not prove what was typed into the original form.

Current booking.created and preorder.converted audit snapshots do not store
original monetary amounts. Reschedule audits also omit them. Subsequent-payment
records are booking.payment_updated audit entries, not a separate deposit table.
They do not establish an original advance. Explicit historical advance snapshots,
receipts or notes require individual review; missing evidence cannot justify repair.
Inspect custom DB triggers, deployment version and original request evidence before
attributing a zero persisted amount to any current source write bug.

Adjacent findings (not changed): blank string advance is rejected with HTTP 400 by
money validation, while omitted advance defaults to zero; conversion caps an
advance above product.price rather than using direct booking's rejection behavior.
Neither finding reproduces a supplied valid 1m advance silently becoming zero.
