import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./model";
export const REPORT_PAGE_SIZE = 50;
export const MAX_EXPORT_ROWS = 50000;
const likeLiteral = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

// One statement gives details, KPIs and grouped totals the same database snapshot.
// Deduplicating preorder links prevents a booking from being counted more than once.
export function buildReportQuery(filters: ReportFilters, page: number, exporting = false): SQL {
  const conditions: SQL[] = [sql`b.booking_date >= ${filters.from}`, sql`b.booking_date <= ${filters.to}`];
  if (filters.branch) conditions.push(sql`b.branch = ${filters.branch}`);
  if (filters.status) conditions.push(sql`b.report_status = ${filters.status}`);
  if (filters.productId) conditions.push(sql`b.product_id = ${Number(filters.productId)}`);
  if (filters.source) conditions.push(sql`b.source = ${filters.source}`);
  if (filters.paymentStatus === "advance") conditions.push(sql`b.advance > 0`);
  if (filters.paymentStatus === "remaining") conditions.push(sql`b.remaining > 0`);
  if (filters.paymentStatus === "paid") conditions.push(sql`b.remaining = 0`);
  if (filters.search) {
    const term = likeLiteral(filters.search);
    const plate = likeLiteral(filters.search.replace(/\s/g, ""));
    conditions.push(sql`(b.booking_no ilike ${term} or b.customer ilike ${term} or b.phone ilike ${term} or regexp_replace(b.plate, '[[:space:]]+', '', 'g') ilike ${plate})`);
  }
  const limit = exporting ? MAX_EXPORT_ROWS + 1 : REPORT_PAGE_SIZE;
  const offset = exporting ? 0 : (page - 1) * REPORT_PAGE_SIZE;
  return sql`
    with base as (
      select b.*, coalesce(nullif(b.product_name, ''), p.name, 'Сонгоогүй') as product_display,
        coalesce(nullif(origin.source, ''), 'manual') as source,
        case when b.status = 'cancelled' then 'Цуцлагдсан' else b.status end as report_status,
        greatest(0, b.total_price::bigint - b.advance::bigint - b.final_paid::bigint) as remaining
      from bookings b
      left join products p on p.id = b.product_id
      left join (
        select distinct on (converted_booking_id) converted_booking_id, source
        from pre_bookings where converted_booking_id is not null
        order by converted_booking_id, created_at, id
      ) origin on origin.converted_booking_id = b.id
    ), filtered as (
      select * from base b where ${sql.join(conditions, sql` and `)}
    ), details as (
      select id, booking_no as "bookingNo", booking_date as date, booking_time as time, branch,
        customer, phone, plate, vehicle, manufacture_year as "manufactureYear",
        product_id as "productId", product_display as "productName", total_price as "totalPrice",
        advance, final_paid as "finalPaid", remaining, report_status as status, source
      from filtered order by booking_date desc, booking_time desc, id desc limit ${limit} offset ${offset}
    ), branch_summary as (
      select branch as label, count(*) as count, sum(total_price) as sales, sum(advance) as advance, sum(remaining) as remaining
      from filtered group by branch order by branch
    ), product_summary as (
      select product_id as "productId", product_display as label, count(*) as count, sum(total_price) as sales
      from filtered group by product_id, product_display order by product_display, product_id
    ), product_options as (
      select distinct on (product_id) product_id as id, product_display as name
      from base where product_id is not null order by product_id, booking_date desc, base.id desc
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(d) from details d), '[]'::jsonb),
      'totals', (select jsonb_build_object('count', count(*), 'sales', coalesce(sum(total_price), 0),
        'advance', coalesce(sum(advance), 0), 'remaining', coalesce(sum(remaining), 0),
        'completed', count(*) filter (where report_status = 'Дууссан'),
        'cancelled', count(*) filter (where report_status = 'Цуцлагдсан')) from filtered),
      'branchSummary', coalesce((select jsonb_agg(s) from branch_summary s), '[]'::jsonb),
      'productSummary', coalesce((select jsonb_agg(s) from product_summary s), '[]'::jsonb),
      'options', jsonb_build_object(
        'branches', coalesce((select jsonb_agg(branch order by branch) from (select distinct branch from base) b), '[]'::jsonb),
        'products', coalesce((select jsonb_agg(p order by name, id) from product_options p), '[]'::jsonb)
      )
    ) as report`;
}
