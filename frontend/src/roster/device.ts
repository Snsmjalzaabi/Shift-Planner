// Expo glue for the roster image reader. Everything here uses native modules
// that the installed app binary already ships (expo-image-manipulator,
// expo-file-system, expo-text-extractor), so the new reader can be delivered
// as a JS-only update. All recognition runs on the device.

import { File, Paths } from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

import { base64ToBytes, decodePng, encodeGreyPng, RgbaImage } from "./image";
import { OcrEngine } from "./imageSource";

/**
 * Longest side used for table analysis. Large enough that 30+ date columns
 * keep readable glyphs, small enough for the JS engine to analyse quickly.
 * (The old importer squeezed every image to 1080 px wide before OCR, which
 * made the codes of a wide monthly roster too small to read.)
 */
const MAX_SIDE = 1800;

export async function loadRosterImage(
  uri: string,
  size?: { width?: number; height?: number },
): Promise<RgbaImage> {
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const actions =
    width >= height && width > MAX_SIDE
      ? [{ resize: { width: MAX_SIDE } }]
      : height > width && height > MAX_SIDE
        ? [{ resize: { height: MAX_SIDE } }]
        : [];
  // Re-encoding through the manipulator also bakes the EXIF orientation into
  // the pixels, so a rotated photo is analysed the right way up.
  const result = await manipulateAsync(uri, actions, { format: SaveFormat.PNG, base64: true });
  if (!result.base64) throw new Error("The image could not be read.");
  return decodePng(base64ToBytes(result.base64));
}

/** ML Kit (Android) / Apple Vision (iOS) reading one rendered cell at a time. */
export async function createDeviceOcrEngine(): Promise<OcrEngine | null> {
  const { isSupported, extractTextFromImage } = await import("expo-text-extractor");
  if (!isSupported) return null;
  let counter = 0;
  return async (crop) => {
    counter += 1;
    const file = new File(Paths.cache, `roster-cell-${Date.now()}-${counter}.png`);
    try {
      file.write(encodeGreyPng(crop));
      // expo-text-extractor's Android module opens `new java.io.File(uri)`
      // for anything that is not a content:// URI, so it needs a plain path;
      // the iOS module takes a file URL.
      const target = Platform.OS === "android" ? decodeURIComponent(file.uri.replace(/^file:\/\//, "")) : file.uri;
      const lines = await extractTextFromImage(target);
      return (lines ?? []).join(" ");
    } finally {
      try {
        file.delete();
      } catch {
        // cache files are cleaned up by the OS as well
      }
    }
  };
}
