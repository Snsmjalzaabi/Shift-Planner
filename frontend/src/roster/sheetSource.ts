// GridSource backed by an Excel sheet. Cells are read straight from the file,
// so the same structure/date/employee logic as the image reader applies
// without any OCR.

import { GridCell, GridSource } from "./extract";
import { pad2 } from "./dates";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  return String(value).trim();
}

/** Excel serial date (e.g. 46327) as ISO, for header cells stored as numbers. */
function serialToIso(value: unknown): string | null {
  if (typeof value !== "number" || value < 20000 || value > 80000) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function createSheetGridSource(rows: unknown[][], title = ""): GridSource {
  const height = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    rows: height,
    cols: width,
    cell(row, col): GridCell {
      return { key: `${row},${col}`, row, col, rowSpan: 1, colSpan: 1, blank: cellText(rows[row]?.[col]) === "" };
    },
    async read(cell, purpose) {
      const value = rows[cell.row]?.[cell.col];
      if (purpose === "header") return serialToIso(value) ?? cellText(value);
      return cellText(value);
    },
    async readTitle() {
      return title;
    },
  };
}
