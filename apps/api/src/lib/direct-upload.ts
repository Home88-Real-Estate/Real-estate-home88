/**
 * Rules for direct-to-storage uploads, kept pure so they are unit-tested.
 *
 * Flow: the API hands out a signed PUT URL for a key it chose, the browser
 * uploads straight to object storage, then confirms; the API checks the
 * stored object before recording it. Large files never pass through an API
 * request (Vercel functions accept at most 4.5 MB).
 */

import { MEDIA_KINDS } from "./media-key";

export const VARIANTS = ["preview", "thumbnail"] as const;
export type Variant = (typeof VARIANTS)[number];

/** Browser-made variants are always JPEG; see the CRM uploader. */
export const VARIANT_MIME = "image/jpeg";

/** Upper bound for a browser-made variant (a 2048px JPEG is far below this). */
export const VARIANT_MAX_BYTES = 8 * 1024 * 1024;

/** Formats whose content we can sniff: the bytes must really be that image. */
const SNIFFABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function mustSniff(mime: string): boolean {
  return SNIFFABLE.has(mime);
}

/** `.../<uuid>.jpg` → `.../<uuid>.preview.jpg`. */
export function variantKey(storageKey: string, variant: Variant): string {
  return `${storageKey.replace(/\.[a-z0-9]{1,8}$/i, "")}.${variant}.jpg`;
}

const KIND_SEGMENT = MEDIA_KINDS.map((kind) => kind.toLowerCase()).join("|");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Whether `storageKey` is an original-upload key the API could have issued for
 * this property. Stops a confirm call from claiming another property's object,
 * a variant, or an arbitrary bucket path.
 */
export function isIssuedKey(storageKey: string, propertyId: string): boolean {
  const escapedId = propertyId.replace(/[^A-Za-z0-9_-]/g, "");
  if (escapedId !== propertyId) return false;
  const pattern = new RegExp(
    `^properties/${escapedId}/(${KIND_SEGMENT})/\\d{4}/\\d{2}/${UUID}\\.[a-z0-9]{1,8}$`,
  );
  return pattern.test(storageKey);
}
