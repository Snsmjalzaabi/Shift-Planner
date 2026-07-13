import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

export type DownloadResult = {
  ok: boolean;
  method: "web-download" | "share-sheet" | "saved" | "failed";
  uri?: string;
  error?: string;
};

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Save a base64 XLSX payload and open the native share sheet (iOS/Android)
 * or trigger a browser download (web).
 */
export async function saveAndShareXlsx(
  base64: string,
  filename: string,
): Promise<DownloadResult> {
  if (Platform.OS === "web") {
    try {
      const byteChars = atob(base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: XLSX_MIME });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, method: "web-download", uri: url };
    } catch (e: any) {
      return { ok: false, method: "failed", error: e?.message || String(e) };
    }
  }

  try {
    const file = new File(Paths.cache, filename);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(base64, { encoding: "base64" });

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(file.uri, {
        mimeType: XLSX_MIME,
        dialogTitle: filename,
        UTI: "org.openxmlformats.spreadsheetml.sheet",
      });
      return { ok: true, method: "share-sheet", uri: file.uri };
    }
    return { ok: true, method: "saved", uri: file.uri };
  } catch (e: any) {
    return { ok: false, method: "failed", error: e?.message || String(e) };
  }
}
