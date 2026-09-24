import { sql } from "drizzle-orm";
import { getHealthyDb } from "../db";

// Cutover switch is OFF by default. The catalog check runs once per server process,
// never by catching a missing-column error in a customer request. Restart after 0015.
let checked: Promise<boolean> | undefined;
export function operations0015Enabled(): Promise<boolean> {
  if (process.env.OPERATIONS_0015_ENABLED !== "true") return Promise.resolve(false);
  checked ??= (async () => {
    const db = await getHealthyDb();
    const rows = await db.execute(sql<{ ready: boolean }>`
      select
        (select count(*) = 5 from information_schema.columns
         where table_schema = 'public' and
           ((table_name = 'booking_notes' and column_name in ('deleted_at','deleted_by'))
            or (table_name = 'pre_bookings' and column_name in ('parent_pre_booking_id','returned_from_booking_id'))
            or (table_name = 'bookings' and column_name = 'returned_to_preorder_at')))
        and to_regclass('public.pre_bookings_converted_booking_unique') is not null
        and to_regclass('public.pre_bookings_returned_from_booking_unique') is not null
        and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.booking_notes')
          and tgname = 'booking_notes_immutable' and tgenabled in ('O','A'))
        and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.pre_bookings')
          and tgname = 'pre_bookings_lineage_guard' and tgenabled in ('O','A')) as ready`);
    return rows[0]?.ready === true;
  })().catch(error => { checked = undefined; throw error; });
  return checked;
}

export const operationsUnavailable = () => Response.json(
  { error: "0015 шинэчлэл идэвхжээгүй байна." }, { status: 503 },
);
export const returnedBookingConflict = () => Response.json(
  { error: "Урьдчилсан захиалга руу буцаасан захиалгыг өөрчлөх боломжгүй." }, { status: 409 },
);

export async function isReturnedBooking(db: { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> }, id: number) {
  if (!(await operations0015Enabled())) return false;
  const rows = await db.execute(sql<{ returned: boolean }>`
    select returned_to_preorder_at is not null as returned from public.bookings where id = ${id}`) as { returned: boolean }[];
  return rows[0]?.returned === true;
}
