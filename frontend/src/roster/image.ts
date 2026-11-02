// Pure-JS raster helpers for the roster reader.
//
// Everything in src/roster/ is plain TypeScript with no React Native imports so
// the whole table-recognition pipeline runs (and is tested) identically in Node
// and inside the Expo app. Only fflate is used, which is pure JS and therefore
// OTA-compatible with the already-installed native binary.

import { unzlibSync, zlibSync } from "fflate";

export type RgbaImage = {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// ---------------------------------------------------------------------------
// Base64 (Hermes does not guarantee atob/btoa for binary data)
// ---------------------------------------------------------------------------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i += 1) table[B64.charCodeAt(i)] = i;
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/^data:[^,]*,/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4) + 3);
  let buffer = 0;
  let bits = 0;
  let length = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = B64_LOOKUP[clean.charCodeAt(i)];
    if (value < 0) continue; // padding, whitespace
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length] = (buffer >> bits) & 0xff;
      length += 1;
    }
  }
  return out.subarray(0, length);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG decode (8-bit, non-interlaced: grey, grey+alpha, RGB, RGBA, palette)
// ---------------------------------------------------------------------------
function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG image");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32(chunk, 0);
      height = readUint32(chunk, 4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "PLTE") {
      palette = chunk;
    } else if (type === "tRNS") {
      transparency = chunk;
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG (bit depth ${bitDepth}, interlace ${interlace})`);
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);

  const total = idat.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(total);
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const raw = unzlibSync(compressed);
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      current[x] = value & 0xff;
    }
    previous = current;
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += channels) {
    const o = i * 4;
    if (colorType === 6) {
      data[o] = pixels[j];
      data[o + 1] = pixels[j + 1];
      data[o + 2] = pixels[j + 2];
      data[o + 3] = pixels[j + 3];
    } else if (colorType === 2) {
      data[o] = pixels[j];
      data[o + 1] = pixels[j + 1];
      data[o + 2] = pixels[j + 2];
      data[o + 3] = 255;
    } else if (colorType === 3 && palette) {
      const index = pixels[j];
      data[o] = palette[index * 3];
      data[o + 1] = palette[index * 3 + 1];
      data[o + 2] = palette[index * 3 + 2];
      data[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    } else {
      const grey = pixels[j];
      data[o] = grey;
      data[o + 1] = grey;
      data[o + 2] = grey;
      data[o + 3] = colorType === 4 ? pixels[j + 1] : 255;
    }
  }
  return flattenAlpha({ width, height, data });
}

/** Composite transparent pixels on white so "transparent" never reads as ink. */
function flattenAlpha(image: RgbaImage): RgbaImage {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 255) continue;
    const a = alpha / 255;
    data[i] = Math.round(data[i] * a + 255 * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
    data[i + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return image;
}

// ---------------------------------------------------------------------------
// PNG encode (greyscale, used for OCR crops)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

export type GreyImage = { width: number; height: number; data: Uint8Array };

export function encodeGreyPng(image: GreyImage): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const raw = new Uint8Array((image.width + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (image.width + 1)] = 0;
    raw.set(image.data.subarray(y * image.width, (y + 1) * image.width), y * (image.width + 1) + 1);
  }
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------
export function luminanceMap(image: RgbaImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let i = 0, j = 0; i < out.length; i += 1, j += 4) {
    out[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
  }
  return out;
}

export type Rect = { left: number; top: number; right: number; bottom: number };

export function rectWidth(rect: Rect): number {
  return rect.right - rect.left;
}

export function rectHeight(rect: Rect): number {
  return rect.bottom - rect.top;
}
