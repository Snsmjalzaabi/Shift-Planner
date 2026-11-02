import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { GridSource } from "../extract";
import { RgbaImage, decodePng, encodeGreyPng } from "../image";
import { createImageGridSource, OcrEngine } from "../imageSource";
import { TableGrid, buildTable } from "../table";

export type FixtureTruth = {
  image: string;
  datesAxis: "columns" | "rows";
  dates: string[];
  employees: { id: string; name: string; assignments: Record<string, string> }[];
  cells: { rect: [number, number, number, number]; text: string; title?: boolean }[];
};

const FIXTURES = join(__dirname, "..", "..", "..", "test-fixtures", "rosters");

export function loadFixture(name: string): { image: RgbaImage; truth: FixtureTruth; table: TableGrid } {
  const truth = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as FixtureTruth;
  const image = decodePng(new Uint8Array(readFileSync(join(FIXTURES, truth.image))));
  const table = buildTable(image);
  if (!table) throw new Error(`no table found in ${name}`);
  return { image, truth, table };
}

/**
 * Ground-truth "reader": returns the text the generator drew inside each
 * detected cell. Tests table structure, date alignment and row extraction
 * independently of OCR quality - a cell boundary in the wrong place returns
 * the wrong text and fails the test.
 */
export function oracleSource(image: RgbaImage, table: TableGrid, truth: FixtureTruth): GridSource {
  const base = createImageGridSource(image, table, async () => "");
  return {
    ...base,
    async read(cell) {
      if (cell.blank) return "";
      const rect = table.cells[cell.row][cell.col].rect;
      return truth.cells
        .filter((c) => !c.title)
        .filter((c) => {
          const cx = (c.rect[0] + c.rect[2]) / 2;
          const cy = (c.rect[1] + c.rect[3]) / 2;
          return cx > rect.left && cx < rect.right && cy > rect.top && cy < rect.bottom;
        })
        .map((c) => c.text)
        .join(" ");
    },
    async readTitle() {
      return truth.cells.find((c) => c.title)?.text ?? "";
    },
    async verifyCode() {
      return true;
    },
  };
}

export function hasTesseract(): boolean {
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stand-in for the on-device recogniser: Tesseract reading the exact same
 * single-cell crops the app sends to ML Kit / Apple Vision.
 */
export function tesseractEngine(): OcrEngine & { dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), "roster-ocr-"));
  let n = 0;
  const engine = (async (crop) => {
    n += 1;
    const file = join(dir, `c${n}.png`);
    writeFileSync(file, encodeGreyPng(crop));
    try {
      return execFileSync("tesseract", [file, "stdout", "--psm", "7"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } finally {
      rmSync(file, { force: true });
    }
  }) as OcrEngine & { dispose(): void };
  engine.dispose = () => rmSync(dir, { recursive: true, force: true });
  return engine;
}
