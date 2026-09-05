export const reportStatuses = ["Хүлээгдэж буй", "Баталгаажсан", "Суурилуулж байна", "Дууссан", "Цуцлагдсан"] as const;
export const paymentOptions = [["", "Бүгд"], ["advance", "Урьдчилгаа төлсөн"], ["remaining", "Үлдэгдэлтэй"], ["paid", "Бүрэн төлсөн"]] as const;
export const sourceOptions = [["", "Бүх эх сурвалж"], ["facebook", "Facebook"], ["website", "Website"], ["manual", "Гараар"]] as const;
export type ReportFilters = { from: string; to: string; branch: string; status: string; productId: string; paymentStatus: string; source: string; search: string };
export type ReportRow = {
  id: number; bookingNo: string; date: string; time: string; branch: string;
  customer: string; phone: string; plate: string; vehicle: string; manufactureYear: number | null;
  productId: number | null; productName: string; totalPrice: number; advance: number;
  finalPaid: number; remaining: number; status: string; source: string;
};
export type ReportTotals = { count: number; sales: number; advance: number; remaining: number; completed: number; cancelled: number };
export type BranchSummary = { label: string; count: number; sales: number; advance: number; remaining: number };
export type ProductSummary = { label: string; productId: number | null; count: number; sales: number };
export type ReportData = {
  rows: ReportRow[]; totals: ReportTotals; branchSummary: BranchSummary[]; productSummary: ProductSummary[];
  options: { branches: string[]; products: { id: number; name: string }[] };
  page: number; pageSize: number; filters: ReportFilters;
};
export function defaultReportFilters(now = new Date()): ReportFilters {
  const to = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { from: `${to.slice(0, 7)}-01`, to, branch: "", status: "", productId: "", paymentStatus: "", source: "", search: "" };
}
export const reportCurrency = (value: number) => `${new Intl.NumberFormat("en-US").format(value)}₮`;
export const sourceLabel = (value: string) => sourceOptions.find(([key]) => key === value)?.[1] || value;
export function reportQuery(filters: ReportFilters) {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
}
export class ReportValidationError extends Error {}
export function parseReportQuery(params: URLSearchParams) {
  const defaults = defaultReportFilters();
  const keys = [...Object.keys(defaults), "page", "format"];
  for (const key of params.keys()) {
    if (!keys.includes(key) || params.getAll(key).length !== 1) throw new ReportValidationError("Тайлангийн шүүлтүүр буруу байна.");
  }
  const filters = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, (params.get(key) ?? value).trim()])) as ReportFilters;
  for (const date of [filters.from, filters.to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < "1900-01-01") throw new ReportValidationError("Огноог зөв оруулна уу.");
  }
  if (filters.from > filters.to) throw new ReportValidationError("Эхлэх огноо дуусах огнооноос хойш байж болохгүй.");
  if (filters.branch.length > 100 || filters.search.length > 100 || /[\u0000-\u001f]/.test(filters.branch + filters.search)) throw new ReportValidationError("Хайлтын утга хэт урт эсвэл буруу байна.");
  if (filters.status === "cancelled") filters.status = "Цуцлагдсан";
  if (filters.status && !reportStatuses.some(value => value === filters.status)) throw new ReportValidationError("Захиалгын төлөв буруу байна.");
  if (!paymentOptions.some(([value]) => value === filters.paymentStatus) || !sourceOptions.some(([value]) => value === filters.source)) throw new ReportValidationError("Төлбөр эсвэл эх сурвалжийн шүүлтүүр буруу байна.");
  if (filters.productId && (!/^[1-9]\d*$/.test(filters.productId) || Number(filters.productId) > 2147483647)) throw new ReportValidationError("Бүтээгдэхүүний дугаар буруу байна.");
  const page = params.get("page") ?? "1";
  if (!/^[1-9]\d*$/.test(page) || Number(page) > 1000000) throw new ReportValidationError("Хуудасны дугаар буруу байна.");
  const format = params.get("format") ?? "json";
  if (format !== "json" && format !== "xlsx") throw new ReportValidationError("Тайлангийн формат буруу байна.");
  return { filters, page: Number(page), format };
}
