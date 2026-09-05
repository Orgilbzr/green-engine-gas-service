export const MANUFACTURE_YEAR_REQUIRED = "Үйлдвэрлэсэн он заавал оруулна уу.";
export const MANUFACTURE_YEAR_INVALID = "Үйлдвэрлэсэн он буруу байна.";
export const LEGACY_PREORDER_YEAR_REQUIRED = "Захиалга болгохын өмнө автомашины үйлдвэрлэсэн оныг оруулна уу.";

export function parseManufactureYear(value: unknown, required = true) {
  if (value === null || value === undefined || value === "") {
    return required ? { year: null, error: MANUFACTURE_YEAR_REQUIRED } : { year: null, error: null };
  }
  const year = typeof value === "number" ? value : Number(value);
  const maxYear = new Date().getFullYear() + 1;
  if (!Number.isInteger(year) || year < 1950 || year > maxYear) return { year: null, error: MANUFACTURE_YEAR_INVALID };
  return { year, error: null };
}

export function manufactureYearDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("manufacture_year_required")) return MANUFACTURE_YEAR_REQUIRED;
  if (message.includes("manufacture_year_invalid")) return MANUFACTURE_YEAR_INVALID;
  return null;
}
