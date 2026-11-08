// Which purchase paths each distribution may show.
//
// Google Play Payments policy: in the Play-distributed Android app, Foxory
// Plus (a digital subscription) may only be sold through Google Play
// Billing. Until that is integrated, the Android app shows no external
// checkout, no external price and no link or text pointing to another way
// to pay. Card checkout (Ziina) stays available on the web only; iOS uses
// the App Store.
//
// Keep this module free of react-native imports so it can be unit-tested.

export type ClientOS = "ios" | "android" | "web" | "windows" | "macos" | string;

export type PurchasePath = "app-store" | "external-web-checkout" | "none";

export function purchasePathFor(os: ClientOS): PurchasePath {
  if (os === "ios") return "app-store";
  if (os === "web") return "external-web-checkout";
  // Android (Google Play) and anything unknown: no purchase path until
  // Google Play Billing is integrated.
  return "none";
}

/** Only the web build may open an outside checkout. */
export function externalCheckoutAllowed(os: ClientOS): boolean {
  return purchasePathFor(os) === "external-web-checkout";
}

/** Plus features, defined in the app so server content cannot add payment text on Android. */
export const PLUS_FEATURES: readonly string[] = [
  "Multi-month planning (any past or future month)",
  "XLSX export with Plan Summary + Shift Details",
  "Attach the XLSX when you email your plan",
];

/** Shown on the Upgrade screen where Plus cannot be bought in this app. */
export const PLUS_UNAVAILABLE_NOTE =
  "Foxory Plus can’t be purchased in this version of the app. All free features keep working.";

// Hosts and words that indicate an outside payment flow. Used by the
// regression test that scans the app source, and by sanitizeServerMessage.
export const PAYMENT_PATTERN = /ziina|stripe|paypal|checkout|payment link|pay\.|\/pay\b|card payment/i;

/**
 * Server text (e.g. a 402 message) shown in the app. On platforms without a
 * purchase path, drop anything that mentions prices or outside payment, so a
 * backend change cannot reintroduce it.
 */
export function sanitizeServerMessage(os: ClientOS, message: string | null | undefined, fallback: string): string {
  const text = (message || "").trim();
  if (!text) return fallback;
  if (purchasePathFor(os) !== "none") return text;
  if (PAYMENT_PATTERN.test(text) || /https?:\/\//i.test(text) || /\$|AED|USD|\/month|price/i.test(text)) return fallback;
  return text;
}
