import writeExcelFile, { type Cell, type CellObject, type SheetData } from "write-excel-file/node";
import { findElement, getOrderOfSiblings, insertElementMarkupAccordingToOrderOfSiblings, replaceElement } from "write-excel-file/utility";
import { sourceLabel, type ReportData } from "./model";

const currencyFormat = '#,##0"₮"';
const header = (labels: string[]): CellObject[] => labels.map(value => ({ value, type: String, fontWeight: "bold", backgroundColor: "#14213D", textColor: "#FFFFFF", wrap: true, height: 32 }));
const amount = (value: number): CellObject => ({ value, type: Number, format: currencyFormat });
// Explicit string cells keep phone/booking identifiers intact and never interpret user text as formulas.
const text = (value: string): CellObject => ({ value, type: String });
const headings = ["Захиалга №", "Огноо", "Цаг", "Салбар", "Үйлчлүүлэгч", "Утас", "Улсын дугаар", "Автомашин", "Үйлдвэрлэсэн он", "Бүтээгдэхүүн", "Нийт үнэ", "Урьдчилгаа", "Үлдэгдэл", "Төлөв", "Эх сурвалж"];

export async function createReportWorkbook(report: ReportData) {
  const { totals, filters } = report;
  const summary: SheetData = [
    header(["Грийн Энжин · Товч тайлан", "Дүн"]),
    ["Тайлангийн хугацаа", `${filters.from} — ${filters.to}`],
    ["Нийт захиалга", totals.count], ["Нийт борлуулалт", amount(totals.sales)],
    ["Нийт урьдчилгаа", amount(totals.advance)], ["Нийт үлдэгдэл", amount(totals.remaining)],
    ["Дууссан", totals.completed], ["Цуцлагдсан", totals.cancelled],
    [], header(["Салбар", "Захиалга", "Борлуулалт", "Урьдчилгаа", "Үлдэгдэл"]),
    ...report.branchSummary.map(row => [text(row.label), row.count, amount(row.sales), amount(row.advance), amount(row.remaining)]),
    [], header(["Бүтээгдэхүүн", "Тоо", "Борлуулалт"]),
    ...report.productSummary.map(row => [text(row.label), row.count, amount(row.sales)]),
  ];
  const details: SheetData = [header(headings), ...report.rows.map(row => {
    const date = new Date(`${row.date}T00:00:00Z`);
    const dateCell: Cell = Number.isFinite(date.getTime()) ? { value: date, type: Date, format: "yyyy-mm-dd" } : text(row.date);
    return [text(row.bookingNo), dateCell, text(row.time), text(row.branch), text(row.customer), text(row.phone), text(row.plate), text(row.vehicle), row.manufactureYear,
      text(row.productName), amount(row.totalPrice), amount(row.advance), amount(row.remaining), text(row.status), text(sourceLabel(row.source))];
  })];
  // The library's supported feature hook adds Excel AutoFilter without a second ZIP library.
  const autoFilter: NonNullable<NonNullable<Parameters<typeof writeExcelFile>[1]>["features"]>[number] = { files: { transform: { "xl/worksheets/sheet{id}.xml": {
    transform(xml, _options, { sheetIndex }) {
      if (sheetIndex !== 1) return xml;
      const markup = `<autoFilter ref="A1:O${details.length}"/>`;
      const existing = findElement(xml, "autoFilter");
      if (existing) return replaceElement(xml, existing, markup);
      const order = getOrderOfSiblings("xl/worksheets/sheet{id}.xml", "worksheet");
      if (!order) throw new Error("Worksheet element order is unavailable");
      return insertElementMarkupAccordingToOrderOfSiblings(xml, markup, order, "worksheet");
    },
  } } } };
  return writeExcelFile([
    { sheet: "Товч тайлан", data: summary, columns: [42, 30, 23, 23, 23].map(width => ({ width })), showGridLines: false },
    { sheet: "Захиалгын дэлгэрэнгүй", data: details, columns: [20, 14, 10, 26, 26, 16, 18, 26, 18, 38, 22, 22, 22, 24, 18].map(width => ({ width })), stickyRowsCount: 1, showGridLines: false },
  ], { fontFamily: "Arial", fontSize: 11, features: [autoFilter] }).toBuffer();
}
