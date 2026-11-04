// GridSource backed by a roster image: table structure from pixels, text from
// an OCR engine that only ever sees one cell at a time.

import { parseHeaderText, parseMonthMention } from "./dates";
import { GridCell, GridSource, ReadPurpose } from "./extract";
import { GreyImage, RgbaImage } from "./image";
import { Rotation, TableCell, TableGrid, glyphSimilarity, renderCellForOcr } from "./table";

/** Reads the text in one rendered cell image. Must not guess. */
export type OcrEngine = (crop: GreyImage) => Promise<string>;

function toGridCell(cell: TableCell): GridCell {
  return {
    key: `${cell.row},${cell.col}`,
    row: cell.row,
    col: cell.col,
    rowSpan: cell.rowSpan,
    colSpan: cell.colSpan,
    blank: cell.blank,
  };
}

/** Text heights (px, upscaled) tried for a shift-code cell, in order. */
const CODE_SCALES = [56, 36, 80, 28];
/** Different heights used for the independent second reading. */
const CHECK_SCALES = [44, 64, 24];
/** Letters whose capital and small forms have the same shape. */
const CASE_AMBIGUOUS = /^[cosuvwxz]+$/;

const usefulHeader = (text: string) => {
  const t = parseHeaderText(text);
  return t.day !== undefined || t.weekday !== undefined || !!parseMonthMention(text);
};

export function createImageGridSource(image: RgbaImage, table: TableGrid, ocr: OcrEngine): GridSource & {
  table: TableGrid;
  ocrCalls: () => number;
} {
  let calls = 0;
  // Rotated header text: remember which rotation worked for each header row.
  const rotationByRow = new Map<number, Rotation>();

  const ocrCell = async (cell: TableCell, rotation: Rotation): Promise<string> => {
    const crop = renderCellForOcr(image, cell.rect, rotation);
    if (!crop) return "";
    calls += 1;
    return (await ocr(crop)).replace(/\s+/g, " ").trim();
  };

  const logical = (gridCell: GridCell) => table.cells[gridCell.row][gridCell.col];

  // Typical capital-letter height in the table: the median ink height of the
  // short upright cells (shift codes, mostly capitals and digits).
  let capHeight: number | null = null;
  const typicalCapHeight = () => {
    if (capHeight !== null) return capHeight;
    const heights: number[] = [];
    const seen = new Set<TableCell>();
    for (const row of table.cells)
      for (const cell of row) {
        if (seen.has(cell) || cell.blank || cell.rotated || !cell.inkBox || cell.colSpan > 1) continue;
        seen.add(cell);
        const w = cell.inkBox.right - cell.inkBox.left;
        const h = cell.inkBox.bottom - cell.inkBox.top;
        if (w <= h * 4) heights.push(h);
      }
    heights.sort((a, b) => a - b);
    capHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
    return capHeight;
  };

  /**
   * "x" and "X" differ only in size. When the recogniser returns a small
   * letter of that kind but the glyph is as tall as the table's capitals,
   * it is the capital.
   */
  const fixCase = (cell: TableCell, text: string) => {
    const compact = text.replace(/\s+/g, "");
    if (!CASE_AMBIGUOUS.test(compact) || !cell.inkBox) return text;
    const reference = typicalCapHeight();
    const h = cell.inkBox.bottom - cell.inkBox.top;
    return reference > 0 && h >= reference * 0.85 ? compact.toUpperCase() : text;
  };

  const readAt = async (cell: TableCell, height: number) => {
    const crop = renderCellForOcr(image, cell.rect, 0, height);
    if (!crop) return "";
    calls += 1;
    return fixCase(cell, (await ocr(crop)).replace(/\s+/g, " ").trim());
  };
  const scaleUsed = new Map<TableCell, number>();

  return {
    table,
    ocrCalls: () => calls,
    rows: table.rows,
    cols: table.cols,
    cell: (row, col) => toGridCell(table.cells[row][col]),
    async read(gridCell: GridCell, purpose: ReadPurpose) {
      const cell = logical(gridCell);
      if (cell.blank) return "";
      if (purpose === "code") {
        // Single letters are read unreliably at some sizes; try a few and keep
        // the first non-empty reading. It is cross-checked in verifyCode.
        for (const height of CODE_SCALES) {
          const text = await readAt(cell, height);
          if (text) {
            scaleUsed.set(cell, height);
            return text;
          }
        }
        return cell.rotated ? ocrCell(cell, 90) : "";
      }
      if (purpose !== "header") {
        const upright = await ocrCell(cell, 0);
        if (upright || !cell.rotated) return upright;
        return ocrCell(cell, 90);
      }
      // Upright first unless the text block is clearly tall and narrow. Other
      // rotations are only tried when the upright reading is empty or is not
      // a date/weekday AND the ink is no wider than tall (a rotated "1" or
      // "12"); ordinary words such as "Name" are never re-read sideways,
      // which used to turn labels into bogus dates.
      const ink = cell.inkBox!;
      const inkW = ink.right - ink.left;
      const inkH = ink.bottom - ink.top;
      const mayBeRotated = cell.rotated || inkW <= inkH * 1.3;
      const preferred = rotationByRow.get(cell.row);
      let order: Rotation[] = cell.rotated ? [90, 270, 0] : [0, 90, 270];
      if (preferred !== undefined && mayBeRotated)
        order = [preferred, ...order.filter((r) => r !== preferred)];
      let upright: string | null = null;
      for (const rotation of order) {
        if (rotation !== 0 && !mayBeRotated) continue;
        const text = await ocrCell(cell, rotation);
        if (rotation === 0) upright = text;
        if (text && usefulHeader(text)) {
          rotationByRow.set(cell.row, rotation);
          return text;
        }
      }
      // Short rotated text (a sideways "7" is wider than tall) is read with the
      // rotation already proven on other cells of the same header row.
      if (!mayBeRotated && preferred !== undefined && preferred !== 0 && cell.colSpan === 1) {
        const text = await ocrCell(cell, preferred);
        if (text && usefulHeader(text)) return text;
      }
      return upright ?? (await ocrCell(cell, 0));
    },
    async readTitle() {
      if (!table.titleRect) return "";
      const content = renderCellForOcr(image, table.titleRect, 0, 40);
      if (!content) return "";
      calls += 1;
      return (await ocr(content)).replace(/\s+/g, " ").trim();
    },
    async verifyCode(gridCell, text) {
      const cell = logical(gridCell);
      const used = scaleUsed.get(cell);
      // Agreement at another size confirms the code; a different non-empty
      // reading contradicts it; empty readings at every size say nothing.
      let anyReading = false;
      for (const height of CHECK_SCALES.concat(CODE_SCALES)) {
        if (height === used) continue;
        const second = (await readAt(cell, height)).replace(/[^0-9A-Za-z]/g, "");
        if (!second) continue;
        anyReading = true;
        if (second === text) return true;
        return false;
      }
      return anyReading ? false : null;
    },
    size(axis, index) {
      const lines = axis === "col" ? table.lines.xs : table.lines.ys;
      return lines[index + 1] - lines[index];
    },
    sameGlyph(a, b) {
      const ca = logical(a);
      const cb = logical(b);
      if (ca === cb) return true;
      if (ca.rotated !== cb.rotated) return false;
      return glyphSimilarity(ca, cb) >= 0.97;
    },
  };
}
