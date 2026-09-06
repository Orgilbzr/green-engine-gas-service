import { parseManufactureYear } from "./manufacture-year";

export const ROLES = ["admin", "operator", "mechanic"] as const;
export const BRANCHES = ["16-ын салбар", "Нарны замын салбар", "3-р салбар"] as const;
export const BOOKING_STATUSES = ["Хүлээгдэж буй", "Баталгаажсан", "Суурилуулж байна", "Дууссан", "Цуцлагдсан", "cancelled"] as const;
export const PREORDER_STATUSES = ["new", "contacted", "converted", "cancelled"] as const;
export const SOURCES = ["manual", "facebook", "website"] as const;
export const PAYMENT_STATUSES = ["", "advance", "remaining", "paid"] as const;
export const ADVANCE_TYPES = ["", "software", "device", "other"] as const;
export const MAX_MONEY = 2147483647;
export class InputError extends Error {}
export function inputErrorResponse(error: unknown) {
  return error instanceof InputError ? Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } }) : null;
}
function invalid(field: string): never { throw new InputError(`${field} буруу байна.`); }
export function validId(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d*$/.test(String(value))) invalid("Дугаар");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) invalid("Дугаар");
  return id;
}
export function text(value: unknown, max: number, field: string, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(field);
  const result = value.trim();if (required && !result) invalid(field);return result;
}
export function enumValue(value: unknown, allowed: readonly string[], field: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(field);return value;
}
export function money(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) invalid("Төлбөрийн дүн");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_MONEY) invalid("Төлбөрийн дүн");return result;
}
export function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) invalid("Огноо");return value;
}
export function validTime(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid("Цаг");return value;
}
export function phone(value: unknown): string {
  const raw = text(value,40,"Утас",true);
  if (!/^[0-9+()\s-]+$/.test(raw)) invalid("Утас");
  const normalized = raw.replace(/[^0-9]/g,"");
  if (normalized.length < 6 || normalized.length > 15) invalid("Утас");return normalized;
}
export function plate(value: unknown, required = true): string {
  const raw = text(value,40,"Улсын дугаар",required).toUpperCase().replace(/\s+/g,"");
  if (!raw && !required) return "";
  if (!/^[A-ZА-ЯӨҮЁ0-9-]{2,20}$/u.test(raw)) invalid("Улсын дугаар");return raw;
}
type Kind = "login" | "booking" | "conversion" | "booking-patch" | "preorder" | "preorder-patch" | "product" | "product-patch" | "user" | "user-patch";
export function validateBody(value: unknown, kind: Kind): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Хүсэлт");
  const raw = value as Record<string, unknown>;
  const out: Record<string, any> = {};
  const patch = kind.endsWith("-patch");
  const booking = kind === "booking" || kind === "conversion";
  const preorder = kind === "preorder";
  const stringFields: Record<string, number> = (kind.startsWith("user") || kind === "login") ? { displayName:120, email:254, password:1024 } : kind.startsWith("product") ? { name:120 } : { customer:120, phone:40, plate:40, vehicle:120, note:500, receipt:200, advanceNote:200, honeypot:200 };
  // Validate supplied known fields even if this endpoint does not persist them.
  for (const [key,max] of Object.entries(stringFields)) if (raw[key] !== undefined) out[key] = text(raw[key],max,key);
  if (booking || preorder) {
    for (const key of ["customer","vehicle"]) out[key] = text(raw[key],120,key,true);
    out.phone = phone(raw.phone);
    out.plate = plate(raw.plate ?? "",booking);
  }
  for (const key of ["branch","status","source","advanceType","role"]) if (raw[key] !== undefined) {
    const allowed = key === "branch" ? BRANCHES : key === "role" ? ROLES : key === "source" ? SOURCES : key === "advanceType" ? ADVANCE_TYPES : kind.startsWith("preorder") ? PREORDER_STATUSES : BOOKING_STATUSES;
    out[key] = enumValue(raw[key],allowed,key);
  }
  for (const key of ["date","booking_date"]) if (raw[key] !== undefined) out[key] = validDate(raw[key]);
  for (const key of ["time","booking_time"]) if (raw[key] !== undefined) out[key] = validTime(raw[key]);
  if (booking) { out.branch=enumValue(raw.branch,BRANCHES,"Салбар");out.date=validDate(raw.date);out.time=validTime(raw.time);out.productId=validId(raw.productId); }
  if (raw.productId !== undefined) out.productId=validId(raw.productId);
  for (const key of ["advance","finalPaid","price","totalPrice"]) if (raw[key] !== undefined) out[key] = money(raw[key]);
  for (const key of ["active","duplicateOverride"]) if (raw[key] !== undefined) { if (typeof raw[key] !== "boolean") invalid(key);out[key]=raw[key]; }
  if (raw.manufactureYear !== undefined || kind === "booking" || preorder) {
    const result=parseManufactureYear(raw.manufactureYear,!patch && kind !== "conversion");
    if(result.error)throw new InputError(result.error);out.manufactureYear=result.year;
  }
  if (kind.startsWith("product")) {
    if (!patch || raw.name !== undefined) out.name=text(raw.name,120,"Бүтээгдэхүүний нэр",true);
    if (!patch || raw.price !== undefined) { out.price=money(raw.price);if(!out.price)invalid("Үнэ"); }
  }
  if (kind === "user") {
    out.email=text(raw.email,254,"Имэйл",true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) invalid("Имэйл");
    out.password=text(raw.password,1024,"Нууц үг",true);
    if (typeof raw.password !== "string" || raw.password.length < 8) invalid("Нууц үг");
    out.password=raw.password;out.role=enumValue(raw.role,ROLES,"Эрх");
  }
  if (kind === "login") {
    out.email=text(raw.email ?? "",254,"Имэйл");
    text(raw.password ?? "",1024,"Нууц үг");out.password=raw.password ?? "";
  }
  const patchFields = kind === "booking-patch" ? ["branch","date","time","finalPaid","manufactureYear","status","advanceType","advanceNote"] : kind === "preorder-patch" ? ["status","manufactureYear"] : kind === "product-patch" ? ["name","price","active"] : ["role","active"];
  if (patch && !patchFields.some(key=>out[key] !== undefined)) invalid("Өөрчлөх мэдээлэл");
  // Each route still builds its DB values explicitly; unknown/security/linkage keys never survive.
  return out;
}
export async function readValidatedBody(request: Request, kind: Kind) {
  return validateBody(await readJsonObject(request),kind);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;try { value=await request.json(); } catch { throw new InputError("Хүсэлтийн мэдээлэл буруу байна."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Хүсэлт");
  return value as Record<string, unknown>;
}
