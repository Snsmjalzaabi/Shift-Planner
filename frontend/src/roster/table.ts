// Table-structure detection for roster screenshots and photos.
//
// The previous importer sent the whole picture to the OCR engine and tried to
// rebuild the table from the returned text. The OCR module the app ships with
// (expo-text-extractor) returns text only, with no coordinates, so the row and
// column structure was lost before parsing even began. Here the structure is
// recovered from the pixels first: ruling lines and fill-colour boundaries give
// the row and column bands, merged cells are detected from missing boundary
// segments, and every cell is then classified (blank / has ink / rotated text)
// before any OCR runs. OCR is only ever asked to read one cell at a time, so a
// value can never drift into a neighbouring column.

import { GreyImage, Rect, RgbaImage, rectHeight, rectWidth } from "./image";

export type GridLines = { xs: number[]; ys: number[] };

export type TableCell = {
  /** Top-left grid position of this (possibly merged) cell. */
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  rect: Rect;
  /** Dominant background colour as #rrggbb. */
  fill: string;
  blank: boolean;
  inkBox: Rect | null;
  inkPixels: number;
  /** Text box is clearly taller than wide (Excel "rotate text up/down"). */
  rotated: boolean;
  /** 16x16 binary ink signature used to group identical glyphs. */
  signature: Uint8Array | null;
};

export type TableGrid = {
  width: number;
  height: number;
  lines: GridLines;
  rows: number;
  cols: number;
  /** cells[r][c] -> the logical cell covering that grid slot. */
  cells: TableCell[][];
  /** Region above the table (titles such as "November 2026"), if any. */
  titleRect: Rect | null;
};

const THIN_LINE_CONTRAST = 24;
const COLOR_STEP = 60;
/** Max colour change for a region to count as flat fill (not text). */
const FLAT = 36;

function colorStep(image: RgbaImage, a: number, b: number): number {
  const { data } = image;
  return (
    Math.abs(data[a * 4] - data[b * 4]) +
    Math.abs(data[a * 4 + 1] - data[b * 4 + 1]) +
    Math.abs(data[a * 4 + 2] - data[b * 4 + 2])
  );
}

/** Box blur of the RGB channels along one axis (suppresses JPEG/sensor noise). Sliding window, O(pixels). */
function blurAlong(image: RgbaImage, axis: "x" | "y", radius: number): Int16Array {
  const { width, height, data } = image;
  const out = new Int16Array(width * height * 3);
  const lines = axis === "x" ? height : width;
  const length = axis === "x" ? width : height;
  const index = (line: number, k: number) => (axis === "x" ? line * width + k : k * width + line);
  for (let line = 0; line < lines; line += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let k = 0; k < Math.min(radius, length); k += 1) {
      const j = index(line, k) * 4;
      r += data[j];
      g += data[j + 1];
      b += data[j + 2];
      n += 1;
    }
    for (let k = 0; k < length; k += 1) {
      const add = k + radius;
      if (add < length) {
        const j = index(line, add) * 4;
        r += data[j];
        g += data[j + 1];
        b += data[j + 2];
        n += 1;
      }
      const drop = k - radius - 1;
      if (drop >= 0) {
        const j = index(line, drop) * 4;
        r -= data[j];
        g -= data[j + 1];
        b -= data[j + 2];
        n -= 1;
      }
      const o = index(line, k) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return out;
}

function dist3(buf: Int16Array, a: number, b: number): number {
  return (
    Math.abs(buf[a * 3] - buf[b * 3]) +
    Math.abs(buf[a * 3 + 1] - buf[b * 3 + 1]) +
    Math.abs(buf[a * 3 + 2] - buf[b * 3 + 2])
  );
}

export type LineMasks = { horizontal: Uint8Array; vertical: Uint8Array };

/**
 * Boolean masks marking pixels that look like part of a horizontal/vertical
 * rule: either a thin line whose colour differs from the pixels two or three
 * steps either side (measured on colour smoothed along the line, so a grey
 * border on a blue cell of equal brightness still counts), or a strong colour
 * change between two flat fills (cell fills without visible borders). The
 * flatness test keeps the edges of letters from registering as rules.
 */
export function lineMasks(image: RgbaImage): LineMasks {
  const { width, height } = image;
  const alongX = blurAlong(image, "x", 2);
  const alongY = blurAlong(image, "y", 2);
  const horizontal = new Uint8Array(width * height);
  const vertical = new Uint8Array(width * height);
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 3; x < width - 3; x += 1) {
      const i = y * width + x;
      const up = Math.max(dist3(alongX, i, i - 2 * width), dist3(alongX, i, i - 3 * width));
      const down = Math.max(dist3(alongX, i, i + 2 * width), dist3(alongX, i, i + 3 * width));
      if (up > THIN_LINE_CONTRAST && down > THIN_LINE_CONTRAST) horizontal[i] = 1;
      else if (
        y >= 4 &&
        y < height - 4 &&
        colorStep(image, i - 2 * width, i + 2 * width) > COLOR_STEP &&
        colorStep(image, i - 4 * width, i - 2 * width) < FLAT &&
        colorStep(image, i + 2 * width, i + 4 * width) < FLAT
      )
        horizontal[i] = 1;
      const left = Math.max(dist3(alongY, i, i - 2), dist3(alongY, i, i - 3));
      const right = Math.max(dist3(alongY, i, i + 2), dist3(alongY, i, i + 3));
      if (left > THIN_LINE_CONTRAST && right > THIN_LINE_CONTRAST) vertical[i] = 1;
      else if (
        x >= 4 &&
        x < width - 4 &&
        colorStep(image, i - 2, i + 2) > COLOR_STEP &&
        colorStep(image, i - 4, i - 2) < FLAT &&
        colorStep(image, i + 2, i + 4) < FLAT
      )
        vertical[i] = 1;
    }
  }
  return { horizontal, vertical };
}

/**
 * Sum of mask run lengths >= minRun along each scan line (single-pixel gaps bridged).
 * When `crossings` is given, a run only counts if it passes through one of
 * those perpendicular rule positions: a real table rule always crosses the
 * other set of rules, while text inside a cell never does.
 */
function runScores(
  mask: Uint8Array,
  width: number,
  height: number,
  axis: "rows" | "cols",
  minRun: number,
  crossings?: number[],
): Float64Array {
  const outer = axis === "rows" ? height : width;
  const inner = axis === "rows" ? width : height;
  const scores = new Float64Array(outer);
  const crossesRule = (start: number, end: number) => {
    if (!crossings) return true;
    for (const c of crossings) if (c > start + 2 && c < end - 3) return true;
    return false;
  };
  for (let o = 0; o < outer; o += 1) {
    let run = 0;
    let gap = 0;
    let total = 0;
    for (let n = 0; n <= inner; n += 1) {
      const on =
        n < inner && (axis === "rows" ? mask[o * width + n] : mask[n * width + o]) === 1;
      if (on) {
        run += 1 + gap;
        gap = 0;
      } else if (run > 0 && gap < 1 && n < inner) {
        gap += 1;
      } else {
        if (run >= minRun && crossesRule(n - gap - run, n - gap)) total += run;
        run = 0;
        gap = 0;
      }
    }
    scores[o] = total;
  }
  return scores;
}

function pickLines(scores: Float64Array, span: number, minGap: number): number[] {
  let max = 0;
  for (const s of scores) max = Math.max(max, s);
  if (max <= 0) return [];
  const threshold = Math.max(max * 0.3, span * 0.12);
  const hits: number[] = [];
  for (let i = 0; i < scores.length; i += 1) if (scores[i] >= threshold) hits.push(i);
  // Merge neighbouring hits (thick or anti-aliased lines) into one position.
  const merged: { pos: number; weight: number }[] = [];
  let group: number[] = [];
  const flush = () => {
    if (!group.length) return;
    let best = group[0];
    for (const g of group) if (scores[g] > scores[best]) best = g;
    merged.push({ pos: best, weight: scores[best] });
    group = [];
  };
  for (const h of hits) {
    if (group.length && h - group[group.length - 1] > 2) flush();
    group.push(h);
  }
  flush();
  // Bands thinner than minGap are not cells: keep the stronger line.
  const out: { pos: number; weight: number }[] = [];
  for (const line of merged) {
    const last = out[out.length - 1];
    if (last && line.pos - last.pos < minGap) {
      if (line.weight > last.weight) out[out.length - 1] = line;
    } else out.push(line);
  }
  return out.map((line) => line.pos);
}

/**
 * Fill in rules that are too faint to pass the global threshold (for example a
 * grey border between two blue cells in a blurred photo) but sit exactly where
 * the regular column/row pitch says a rule must be. Only a local score peak at
 * the predicted position is accepted, so nothing is invented on blank paper.
 */
function fillRegularGaps(lines: number[], scores: Float64Array): number[] {
  const pitch = medianGap(lines);
  if (pitch <= 0 || lines.length < 4) return lines;
  let max = 0;
  for (const s of scores) max = Math.max(max, s);
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = lines[i] - lines[i - 1];
    const k = Math.round(gap / pitch);
    if (k >= 2 && k <= 6 && Math.abs(gap - k * pitch) <= pitch * 0.15 * k) {
      const step = gap / k;
      for (let j = 1; j < k; j += 1) {
        const predicted = Math.round(lines[i - 1] + step * j);
        let best = -1;
        for (let d = -3; d <= 3; d += 1) {
          const q = predicted + d;
          if (q > 0 && q < scores.length - 1 && (best < 0 || scores[q] > scores[best])) best = q;
        }
        const background = Math.min(
          scores[Math.max(0, best - 5)] ?? 0,
          scores[Math.min(scores.length - 1, best + 5)] ?? 0,
        );
        if (best >= 0 && scores[best] >= max * 0.08 && scores[best] > background * 2 + 1) out.push(best);
      }
    }
    out.push(lines[i]);
  }
  return out;
}

function medianGap(lines: number[]): number {
  const gaps = lines.slice(1).map((v, i) => v - lines[i]).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
}

/**
 * Two passes: a permissive pass estimates the typical row height / column
 * width, then the final pass only accepts runs that are long relative to the
 * cell size. Ruling lines cross whole cells; letter strokes ("N", "D", "1")
 * only cover part of one, so text can no longer be mistaken for a column edge.
 */
export function detectGridLines(image: RgbaImage, masks = lineMasks(image)): GridLines {
  const { width, height } = image;
  const baseRun = Math.max(10, Math.round(Math.min(width, height) / 120));
  const minGap = Math.max(7, Math.round(Math.min(width, height) / 200));
  let rowScores = runScores(masks.horizontal, width, height, "rows", baseRun);
  let colScores = runScores(masks.vertical, width, height, "cols", baseRun);
  let ys = pickLines(rowScores, width, minGap);
  let xs = pickLines(colScores, height, minGap);
  // Re-estimate the cell pitch until stable: text that slipped into the first
  // pass shrinks the median, and the next pass removes it.
  for (let pass = 0; pass < 3; pass += 1) {
    const rowHeight = medianGap(ys);
    const colWidth = medianGap(xs);
    if (rowHeight <= 0 || colWidth <= 0) break;
    const vRun = Math.max(baseRun, Math.round(rowHeight * 0.75));
    const hRun = Math.max(baseRun, Math.round(colWidth * 0.75));
    rowScores = runScores(masks.horizontal, width, height, "rows", hRun, xs);
    colScores = runScores(masks.vertical, width, height, "cols", vRun, ys);
    const nextYs = pickLines(rowScores, width, minGap);
    const nextXs = pickLines(colScores, height, minGap);
    const stable = nextYs.join() === ys.join() && nextXs.join() === xs.join();
    ys = nextYs;
    xs = nextXs;
    if (stable) break;
  }
  ys = fillRegularGaps(ys, rowScores);
  xs = fillRegularGaps(xs, colScores);
  return { ys, xs };
}

// ---------------------------------------------------------------------------
// Merged cells
// ---------------------------------------------------------------------------
/**
 * A boundary between two grid slots exists when one straight line (single
 * offset within +-2 px of the detected rule) covers most of the shared edge.
 * Letter strokes inside a merged banner ("NOVEMBER 2026") cover far less of
 * the edge, so they no longer split merged cells.
 */
function boundaryPresent(
  masks: LineMasks,
  width: number,
  height: number,
  orientation: "vertical" | "horizontal",
  at: number,
  from: number,
  to: number,
): boolean {
  const trim = Math.max(2, Math.round((to - from) * 0.12));
  const start = from + trim;
  const end = to - trim;
  if (end <= start) return true;
  let best = 0;
  for (let d = -2; d <= 2; d += 1) {
    const q = at + d;
    if (orientation === "vertical" ? q < 0 || q >= width : q < 0 || q >= height) continue;
    let present = 0;
    for (let p = start; p < end; p += 1) {
      const on =
        orientation === "vertical" ? masks.vertical[p * width + q] : masks.horizontal[q * width + p];
      if (on) present += 1;
    }
    best = Math.max(best, present / (end - start));
  }
  return best >= 0.8;
}

/** Does ink appear on both sides of a (missing) boundary at the same height? */
function inkCrosses(
  image: RgbaImage,
  orientation: "vertical" | "horizontal",
  at: number,
  from: number,
  to: number,
): boolean {
  const { width, height } = image;
  const offset = 3;
  const sample = (p: number, side: -1 | 1) => {
    const q = at + side * offset;
    const x = orientation === "vertical" ? q : p;
    const y = orientation === "vertical" ? p : q;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return y * width + x;
  };
  // Background reference: colour a few pixels further away from the boundary.
  let hits = 0;
  for (let p = from + 2; p < to - 2; p += 1) {
    const a = sample(p, -1);
    const b = sample(p, 1);
    if (a === null || b === null) continue;
    const refA = sample(from + 2 === p ? p + 1 : from + 2, -1);
    const refB = sample(from + 2 === p ? p + 1 : from + 2, 1);
    if (refA === null || refB === null) continue;
    if (colorStep(image, a, refA) > 120 && colorStep(image, b, refB) > 120) hits += 1;
  }
  return hits >= 2;
}

// ---------------------------------------------------------------------------
// Cell content
// ---------------------------------------------------------------------------
function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function insetRect(rect: Rect): Rect {
  const dx = Math.max(2, Math.round(rectWidth(rect) * 0.06));
  const dy = Math.max(2, Math.round(rectHeight(rect) * 0.06));
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: Math.max(rect.left + dx + 1, rect.right - dx),
    bottom: Math.max(rect.top + dy + 1, rect.bottom - dy),
  };
}

function dominantColor(image: RgbaImage, rect: Rect): [number, number, number] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const { data, width } = image;
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      const i = (y * width + x) * 4;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      entry.n += 1;
      entry.r += data[i];
      entry.g += data[i + 1];
      entry.b += data[i + 2];
      counts.set(key, entry);
    }
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const entry of counts.values()) if (entry.n > best.n) best = entry;
  if (!best.n) return [255, 255, 255];
  return [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round) as [
    number,
    number,
    number,
  ];
}

function colorDistance(image: RgbaImage, i: number, fill: [number, number, number]): number {
  const { data } = image;
  return Math.max(
    Math.abs(data[i * 4] - fill[0]),
    Math.abs(data[i * 4 + 1] - fill[1]),
    Math.abs(data[i * 4 + 2] - fill[2]),
  );
}

/** 0 = background, up to 255 = clearly ink. */
export function inkLevel(image: RgbaImage, i: number, fill: [number, number, number]): number {
  const { data } = image;
  const d = Math.max(
    Math.abs(data[i * 4] - fill[0]),
    Math.abs(data[i * 4 + 1] - fill[1]),
    Math.abs(data[i * 4 + 2] - fill[2]),
  );
  return d < 40 ? 0 : Math.min(255, Math.round(((d - 40) / 80) * 255));
}

function analyseCell(image: RgbaImage, rect: Rect) {
  const inner = insetRect(rect);
  const fill = dominantColor(image, inner);
  let inkPixels = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = inner.top; y < inner.bottom; y += 1) {
    for (let x = inner.left; x < inner.right; x += 1) {
      if (inkLevel(image, y * image.width + x, fill) > 96) {
        inkPixels += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  const area = rectWidth(inner) * rectHeight(inner);
  const blank = inkPixels < Math.max(5, area * 0.004);
  const inkBox = blank ? null : { left, top, right, bottom };
  const rotated =
    !!inkBox &&
    rectHeight(inkBox) > rectWidth(inkBox) * 1.6 &&
    rectHeight(inkBox) > rectHeight(inner) * 0.35;
  let signature: Uint8Array | null = null;
  if (inkBox) {
    signature = new Uint8Array(16 * 16);
    const w = rectWidth(inkBox);
    const h = rectHeight(inkBox);
    for (let sy = 0; sy < 16; sy += 1) {
      for (let sx = 0; sx < 16; sx += 1) {
        let ink = 0;
        let total = 0;
        const y0 = inkBox.top + Math.floor((sy * h) / 16);
        const y1 = inkBox.top + Math.max(Math.floor(((sy + 1) * h) / 16), Math.floor((sy * h) / 16) + 1);
        const x0 = inkBox.left + Math.floor((sx * w) / 16);
        const x1 = inkBox.left + Math.max(Math.floor(((sx + 1) * w) / 16), Math.floor((sx * w) / 16) + 1);
        for (let y = y0; y < y1; y += 1)
          for (let x = x0; x < x1; x += 1) {
            total += 1;
            if (inkLevel(image, y * image.width + x, fill) > 96) ink += 1;
          }
        signature[sy * 16 + sx] = total && ink / total >= 0.4 ? 1 : 0;
      }
    }
  }
  return { fill: hex(...fill), fillRgb: fill, blank, inkBox, inkPixels, rotated, signature };
}

/** Similarity of two cells' glyphs, 0..1 (1 = pixel-identical shapes). */
export function glyphSimilarity(a: TableCell, b: TableCell): number {
  if (!a.signature || !b.signature || !a.inkBox || !b.inkBox) return 0;
  const wa = rectWidth(a.inkBox);
  const wb = rectWidth(b.inkBox);
  const ha = rectHeight(a.inkBox);
  const hb = rectHeight(b.inkBox);
  if (Math.abs(wa - wb) > Math.max(2, 0.12 * Math.max(wa, wb))) return 0;
  if (Math.abs(ha - hb) > Math.max(2, 0.12 * Math.max(ha, hb))) return 0;
  let same = 0;
  for (let i = 0; i < a.signature.length; i += 1) if (a.signature[i] === b.signature[i]) same += 1;
  return same / a.signature.length;
}

// ---------------------------------------------------------------------------
// Grid assembly
// ---------------------------------------------------------------------------
/**
 * Rule detection runs on a copy no larger than this (longest side). Rules are
 * long, high-contrast structures that survive downscaling well, and this keeps
 * the pass fast on the phone's JS engine; cell contents are still analysed
 * and read at full resolution.
 */
const ANALYSIS_MAX_SIDE = 1200;

function downsample(image: RgbaImage, scale: number): RgbaImage {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy += 1)
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * image.width + xx) * 4;
          r += image.data[i];
          g += image.data[i + 1];
          b += image.data[i + 2];
          n += 1;
        }
      const o = (y * width + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Snap a rule found on the downscaled copy to the darkest nearby line at full size. */
function refineLine(image: RgbaImage, axis: "x" | "y", approx: number): number {
  const limit = axis === "x" ? image.width : image.height;
  const span = axis === "x" ? image.height : image.width;
  let best = approx;
  let bestValue = Infinity;
  let total = 0;
  let count = 0;
  for (let p = Math.max(0, approx - 3); p <= Math.min(limit - 1, approx + 3); p += 1) {
    let sum = 0;
    let n = 0;
    for (let q = 0; q < span; q += 2) {
      const i = (axis === "x" ? q * image.width + p : p * image.width + q) * 4;
      sum += image.data[i] + image.data[i + 1] + image.data[i + 2];
      n += 1;
    }
    const value = sum / Math.max(1, n);
    total += value;
    count += 1;
    if (value < bestValue) {
      bestValue = value;
      best = p;
    }
  }
  return bestValue < total / Math.max(1, count) - 3 ? best : approx;
}

export function buildTable(image: RgbaImage): TableGrid | null {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(image.width, image.height));
  const small = scale < 1 ? downsample(image, scale) : image;
  const masks = lineMasks(small);
  const smallLines = detectGridLines(small, masks);
  if (smallLines.xs.length < 3 || smallLines.ys.length < 3) return null;
  const xs =
    scale < 1
      ? smallLines.xs.map((x) => refineLine(image, "x", Math.min(image.width - 1, Math.round(x / scale))))
      : smallLines.xs;
  const ys =
    scale < 1
      ? smallLines.ys.map((y) => refineLine(image, "y", Math.min(image.height - 1, Math.round(y / scale))))
      : smallLines.ys;
  const lines = { xs, ys };
  const rows = ys.length - 1;
  const cols = xs.length - 1;
  const { width, height } = small;
  const sx = smallLines.xs;
  const sy = smallLines.ys;

  // Union-find over grid slots to recover merged cells.
  const parent = new Int32Array(rows * cols).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  // Two slots are one merged cell only when no rule separates them AND text
  // physically runs across the missing rule ("NOVEMBER 2026" banner, a
  // "Staff ID" label spanning two header rows). A faint rule between two cells
  // of the same colour therefore never fuses their contents.
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (
        c + 1 < cols &&
        !boundaryPresent(masks, width, height, "vertical", sx[c + 1], sy[r], sy[r + 1]) &&
        inkCrosses(small, "vertical", sx[c + 1], sy[r], sy[r + 1])
      )
        union(r * cols + c, r * cols + c + 1);
      if (
        r + 1 < rows &&
        !boundaryPresent(masks, width, height, "horizontal", sy[r + 1], sx[c], sx[c + 1]) &&
        inkCrosses(small, "horizontal", sy[r + 1], sx[c], sx[c + 1])
      )
        union(r * cols + c, (r + 1) * cols + c);
    }
  }

  const groups = new Map<number, { r0: number; c0: number; r1: number; c1: number }>();
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      const root = find(r * cols + c);
      const g = groups.get(root) ?? { r0: r, c0: c, r1: r, c1: c };
      g.r0 = Math.min(g.r0, r);
      g.c0 = Math.min(g.c0, c);
      g.r1 = Math.max(g.r1, r);
      g.c1 = Math.max(g.c1, c);
      groups.set(root, g);
    }

  const logical = new Map<number, TableCell>();
  const cells: TableCell[][] = Array.from({ length: rows }, () => new Array<TableCell>(cols));
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      const root = find(r * cols + c);
      let cell = logical.get(root);
      if (!cell) {
        const g = groups.get(root)!;
        // A non-rectangular union (should not happen with real tables) falls
        // back to the single slot so no content is attributed to the wrong cell.
        const rect = { left: xs[g.c0], top: ys[g.r0], right: xs[g.c1 + 1], bottom: ys[g.r1 + 1] };
        const content = analyseCell(image, rect);
        cell = {
          row: g.r0,
          col: g.c0,
          rowSpan: g.r1 - g.r0 + 1,
          colSpan: g.c1 - g.c0 + 1,
          rect,
          fill: content.fill,
          blank: content.blank,
          inkBox: content.inkBox,
          inkPixels: content.inkPixels,
          rotated: content.rotated,
          signature: content.signature,
        };
        logical.set(root, cell);
      }
      cells[r][c] = cell;
    }

  let titleRect: Rect | null = null;
  if (ys[0] > 14) {
    const rect = { left: 0, top: 0, right: image.width, bottom: ys[0] - 1 };
    if (!analyseCell(image, rect).blank) titleRect = rect;
  }
  return { width: image.width, height: image.height, lines, rows, cols, cells, titleRect };
}

// ---------------------------------------------------------------------------
// OCR crop rendering
// ---------------------------------------------------------------------------
export type Rotation = 0 | 90 | 270;

function rotateGrey(image: GreyImage, rotation: Rotation): GreyImage {
  if (rotation === 0) return image;
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const v = data[y * width + x];
      if (rotation === 90) out[x * height + (height - 1 - y)] = v; // clockwise
      else out[(width - 1 - x) * height + y] = v; // counter-clockwise
    }
  return { width: height, height: width, data: out };
}

/**
 * Render a cell's content as clean black-on-white text, upscaled and padded so
 * a single letter such as "D" or "N" is large enough for on-device OCR.
 * Background colour is removed entirely, so coloured shift cells read the same
 * as white ones.
 */
export function renderCellForOcr(
  image: RgbaImage,
  rect: Rect,
  rotation: Rotation = 0,
  targetTextHeight = 56,
): GreyImage | null {
  const content = analyseCell(image, rect);
  if (content.blank || !content.inkBox) return null;
  const box = content.inkBox;
  const margin = 2;
  const left = Math.max(rect.left, box.left - margin);
  const top = Math.max(rect.top, box.top - margin);
  const right = Math.min(rect.right, box.right + margin);
  const bottom = Math.min(rect.bottom, box.bottom + margin);
  // Contrast-normalise per cell: a blurred or low-contrast photo still yields
  // solid black strokes, while the cell fill maps to pure white.
  const distances: number[] = [];
  for (let y = top; y < bottom; y += 1)
    for (let x = left; x < right; x += 1) distances.push(colorDistance(image, y * image.width + x, content.fillRgb));
  distances.sort((p, q) => p - q);
  const strong = distances[Math.floor(distances.length * 0.97)] || 1;
  const lo = Math.max(30, strong * 0.45);
  const hi = Math.max(lo + 10, strong * 0.85);
  const level = (i: number) => {
    const dd = colorDistance(image, i, content.fillRgb);
    return dd <= lo ? 0 : dd >= hi ? 255 : Math.round(((dd - lo) / (hi - lo)) * 255);
  };
  const srcW = right - left;
  const srcH = bottom - top;
  const textHeight = rotation === 0 ? srcH : srcW;
  const scale = Math.min(8, Math.max(1, targetTextHeight / Math.max(1, textHeight)));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const pad = 28;
  const out: GreyImage = {
    width: w + pad * 2,
    height: h + pad * 2,
    data: new Uint8Array((w + pad * 2) * (h + pad * 2)).fill(255),
  };
  for (let y = 0; y < h; y += 1) {
    const sy = top + Math.min(srcH - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(top, Math.floor(sy));
    const y1 = Math.min(bottom - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < w; x += 1) {
      const sx = left + Math.min(srcW - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(left, Math.floor(sx));
      const x1 = Math.min(right - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const a = level(y0 * image.width + x0);
      const b = level(y0 * image.width + x1);
      const c = level(y1 * image.width + x0);
      const d = level(y1 * image.width + x1);
      const ink = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      out.data[(y + pad) * out.width + x + pad] = 255 - Math.round(ink);
    }
  }
  return rotateGrey(out, rotation);
}
