/**
 * Single source of truth for the spoofed client identity.
 *
 * Notion Calendar (post ~2026-05-05) redirects unofficial wrappers to the download page.
 * The wire headers (main process) and the `navigator` overrides (preload) must agree — a
 * macOS User-Agent paired with Linux Client Hints is itself a detection signal. These lived
 * in two hand-synced copies before; keep them here so they cannot drift again.
 *
 * Bumping the Chrome version is a behavioural change against Notion's detection. Test it,
 * do not fold it into an unrelated commit.
 */

export const CHROME_MAJOR = "135";
export const CHROME_FULL_VERSION = "135.0.0.0";

export const CHROME_UA =
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`;

/** `navigator.appVersion` is the UA with the leading "Mozilla/" stripped. */
export const CHROME_APP_VERSION = CHROME_UA.replace(/^Mozilla\//, "");

/** Low-entropy `Sec-CH-UA` brands, and the `navigator.userAgentData.brands` they mirror. */
export const UA_BRANDS: ReadonlyArray<{ brand: string; version: string }> = [
  { brand: "Chromium", version: CHROME_MAJOR },
  { brand: "Google Chrome", version: CHROME_MAJOR },
  { brand: "Not;A=Brand", version: "99" },
];

/** High-entropy `getHighEntropyValues().fullVersionList`. */
export const UA_FULL_VERSION_LIST: ReadonlyArray<{ brand: string; version: string }> = [
  { brand: "Chromium", version: CHROME_FULL_VERSION },
  { brand: "Google Chrome", version: CHROME_FULL_VERSION },
  { brand: "Not;A=Brand", version: "99.0.0.0" },
];

/** `Sec-CH-UA` header value, derived from UA_BRANDS so the two cannot disagree. */
export const SEC_CH_UA = UA_BRANDS.map((b) => `"${b.brand}";v="${b.version}"`).join(", ");

/** `Sec-CH-UA-Platform` / `navigator.userAgentData.platform`. */
export const UA_PLATFORM = "macOS";
export const UA_PLATFORM_VERSION = "15.0.0";
/** `navigator.platform`, which uses the older non-Client-Hints spelling. */
export const NAVIGATOR_PLATFORM = "MacIntel";
export const NAVIGATOR_VENDOR = "Google Inc.";
