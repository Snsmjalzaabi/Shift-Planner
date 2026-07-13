import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as MailComposer from "expo-mail-composer";
import { Linking, Platform } from "react-native";

export type OpenMailResult = {
  ok: boolean;
  method: "native" | "mailto" | "clipboard" | "failed";
  status?: MailComposer.MailComposerStatus | string;
  error?: string;
};

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Open the platform's native mail composer pre-filled with the Foxory draft
 * plan email. Falls back gracefully:
 *   1. `expo-mail-composer` (iOS Mail / Android Gmail-family / macOS Mail)
 *   2. `mailto:` deep-link (any mobile browser / other mail clients)
 *   3. Copy to clipboard as a last resort.
 */
export async function openDraftPlanMail(opts: {
  to: string;
  subject: string;
  body: string;
  html?: string;
  xlsxBase64?: string | null;
  xlsxFilename?: string;
}): Promise<OpenMailResult> {
  const { to, subject, body, html, xlsxBase64, xlsxFilename } = opts;

  const available =
    Platform.OS !== "web" && (await MailComposer.isAvailableAsync());
  if (available) {
    try {
      const attachments: string[] = [];
      if (xlsxBase64 && xlsxFilename) {
        const file = new File(Paths.cache, xlsxFilename);
        if (file.exists) file.delete();
        file.create();
        file.write(xlsxBase64, { encoding: "base64" });
        attachments.push(file.uri);
      }
      const result = await MailComposer.composeAsync({
        recipients: [to],
        subject,
        body: html || body,
        isHtml: !!html,
        attachments,
      });
      return { ok: true, method: "native", status: result.status };
    } catch {
      // fall through to mailto
    }
  }

  // mailto: fallback (mobile web / desktop web / no mail app configured)
  try {
    const mailto =
      `mailto:${encodeURIComponent(to)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
    if (Platform.OS === "web") {
      window.location.href = mailto;
    } else {
      const supported = await Linking.canOpenURL(mailto);
      if (supported) {
        await Linking.openURL(mailto);
      } else {
        throw new Error("No mail app is configured on this device.");
      }
    }
    return { ok: true, method: "mailto" };
  } catch (e: any) {
    // Last-ditch: copy to clipboard so the user can paste anywhere.
    try {
      await Clipboard.setStringAsync(`${subject}\n\n${body}`);
      return {
        ok: true,
        method: "clipboard",
        error: e?.message || "No mail app available; copied to clipboard.",
      };
    } catch (e2: any) {
      return { ok: false, method: "failed", error: e2?.message || String(e2) };
    }
  }
}

// Re-export mime for callers if needed.
export const DRAFT_ATTACHMENT_MIME = XLSX_MIME;
