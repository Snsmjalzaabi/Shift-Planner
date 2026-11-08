// Regression tests for the Google Play Payments policy fix: the Android
// (Google Play) app must not open, link to or describe an outside checkout.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  externalCheckoutAllowed,
  PAYMENT_PATTERN,
  PLUS_FEATURES,
  PLUS_UNAVAILABLE_NOTE,
  purchasePathFor,
  sanitizeServerMessage,
} from "../billingPolicy";

const FRONTEND = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.bak/.test(name)) out.push(path);
  }
  return out;
}

const APP_SOURCES = [...sourceFiles(join(FRONTEND, "app")), ...sourceFiles(join(FRONTEND, "src"))];
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(FRONTEND, path);

describe("purchase paths per platform", () => {
  it("never allows an outside checkout on Android", () => {
    expect(purchasePathFor("android")).toBe("none");
    expect(externalCheckoutAllowed("android")).toBe(false);
  });

  it("uses the App Store on iOS and keeps card checkout on the web only", () => {
    expect(purchasePathFor("ios")).toBe("app-store");
    expect(externalCheckoutAllowed("ios")).toBe(false);
    expect(purchasePathFor("web")).toBe("external-web-checkout");
    expect(externalCheckoutAllowed("web")).toBe(true);
  });

  it("treats unknown platforms like Android (no purchase path)", () => {
    expect(externalCheckoutAllowed("windows")).toBe(false);
  });

  it("describes Plus without prices or payment providers", () => {
    for (const text of [...PLUS_FEATURES, PLUS_UNAVAILABLE_NOTE]) {
      expect(text).not.toMatch(PAYMENT_PATTERN);
      expect(text).not.toMatch(/\$|AED|USD|\/month|https?:/i);
    }
  });
});

describe("server messages shown in the app (remote content)", () => {
  const fallback = "This feature is part of Foxory Plus.";

  it.each([
    "This feature is available on the Plus $2.99/month plan.",
    "Pay AED 10.99 with Ziina to unlock Plus.",
    "Upgrade at https://example.com/checkout",
    "Use our payment link to subscribe.",
  ])("drops payment wording on Android: %s", (message) => {
    expect(sanitizeServerMessage("android", message, fallback)).toBe(fallback);
  });

  it("keeps neutral messages, and leaves web and iOS unchanged", () => {
    expect(sanitizeServerMessage("android", "Multi-month planning is a Plus feature.", fallback)).toBe(
      "Multi-month planning is a Plus feature.",
    );
    expect(sanitizeServerMessage("web", "Pay with Ziina", fallback)).toBe("Pay with Ziina");
    expect(sanitizeServerMessage("android", "", fallback)).toBe(fallback);
  });
});

describe("api client on Android", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("react-native", () => ({ Platform: { OS: "android" } }));
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.doUnmock("react-native");
    vi.unstubAllGlobals();
  });

  it("refuses to start an outside checkout without calling the server", async () => {
    const { api } = await import("../api");
    await expect(api.checkout("token")).rejects.toThrow(/not available/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identifies itself so the server can withhold checkout", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ plans: [] }) });
    const { api } = await import("../api");
    await api.billingConfig();
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Foxory-Platform"]).toBe("android");
  });

  it("replaces a priced 402 message from the server", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        detail: { code: "plus_required", message: "Plus is $2.99/month — pay at https://pay.example.com" },
      }),
    });
    const { api } = await import("../api");
    await expect(api.exportXlsx("token", { month: "2026-11" } as any)).rejects.toThrow(
      "This feature is part of Foxory Plus.",
    );
  });
});

describe("app source (static checks)", () => {
  it("has no hard-coded payment or checkout URLs", () => {
    const offenders = APP_SOURCES.filter((f) =>
      /https?:\/\/[^"'`\s]*(ziina|stripe|paypal|checkout|\/pay\b|pay\.)/i.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("only opens known informational links", () => {
    const allowed = [/^mailto:(support|privacy)@foxory\.info$/, /^https:\/\/foxory\.net\/?$/];
    const found: string[] = [];
    for (const f of APP_SOURCES) {
      for (const m of read(f).matchAll(/(?:Linking\.openURL|WebBrowser\.open\w*)\(\s*["'`]([^"'`]+)["'`]/g)) {
        if (!allowed.some((re) => re.test(m[1]))) found.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("starts the outside checkout only from the Upgrade screen", () => {
    const callers = APP_SOURCES.filter((f) => /api\.checkout\(|openAuthSessionAsync\(/.test(read(f))).map(rel);
    expect(callers).toEqual([join("app", "(app)", "upgrade.tsx")]);
  });

  it("keeps the checkout guard in the api client", () => {
    const api = read(join(FRONTEND, "src", "lib", "api.ts"));
    const checkout = api.slice(api.indexOf("checkout: ("), api.indexOf("verifyCheckout:"));
    expect(checkout).toMatch(/if \(!externalCheckoutAllowed\(Platform\.OS\)\)/);
  });

  it("hides the subscribe button, price and provider on the Upgrade screen when there is no purchase path", () => {
    const screen = read(join(FRONTEND, "app", "(app)", "upgrade.tsx"));
    expect(screen).toMatch(/const noPurchase = purchasePathFor\(Platform\.OS\) === "none"/);
    expect(screen).toMatch(/\{!isPlus && !noPurchase && \(\s*<Pressable\s+testID="upgrade-cta"/);
    expect(screen).toMatch(/\{!noPurchase && \(\s*<View style=\{styles\.priceRow\}>/);
    expect(screen).toMatch(/\{noPurchase \? \(\s*PLUS_UNAVAILABLE_NOTE/);
    expect(screen).toMatch(/if \(!isApple && !externalCheckoutAllowed\(Platform\.OS\)\) return;/);
    // Remote billing config is not even fetched on Android.
    expect(screen).toMatch(/if \(noPurchase\) \{\s*setLoading\(false\);\s*return;/);
  });

  it("shows no price in Settings outside the web build", () => {
    const settings = read(join(FRONTEND, "app", "(app)", "settings.tsx"));
    expect(settings).toMatch(/Platform\.OS === "web"\s*\?\s*"AED 10\.99\/month/);
  });
});
