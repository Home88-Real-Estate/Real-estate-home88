/**
 * Photo processing for public uploads.
 *
 * The master we keep is re-encoded: orientation is applied to the pixels and
 * every metadata block (EXIF, GPS, XMP, IPTC, embedded thumbnails) is dropped,
 * so a phone photo can never publish where the owner lives. Variants are WebP.
 * `failOn: "error"` and a pixel budget stop a crafted file from exhausting
 * memory; any failure is reported as a reason, never thrown at the caller.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";

import type { UploadLimits } from "./files";

export const VARIANT_WIDTHS = { thumbnail: 320, card: 640, medium: 1280, large: 2048 } as const;
export type VariantName = keyof typeof VARIANT_WIDTHS;

export function variantStorageKey(storageKey: string, variant: VariantName): string {
  return `${storageKey.replace(/\.[a-z0-9]{1,8}$/i, "")}.${variant}.webp`;
}

export type ProcessedPhoto = {
  ok: true;
  /** SHA-256 of the bytes as uploaded (used to spot duplicates). */
  checksum: string;
  width: number;
  height: number;
  /** The sanitised master to store in place of the upload. */
  master: { body: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp" };
  variants: Record<VariantName, Buffer>;
  hadMetadata: boolean;
};

export type RejectedPhoto = { ok: false; reason: string; checksum: string };

export function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function processPhoto(input: Buffer, limits: UploadLimits): Promise<ProcessedPhoto | RejectedPhoto> {
  const checksum = sha256(input);
  try {
    const base = () => sharp(input, { failOn: "error", limitInputPixels: limits.maxPixels });
    const meta = await base().metadata();
    const format = meta.format;
    if (format !== "jpeg" && format !== "png" && format !== "webp") return { ok: false, reason: "not a supported image", checksum };

    const hadMetadata = Boolean(meta.exif || meta.xmp || meta.iptc);

    // `.rotate()` applies EXIF orientation; with no `keepMetadata()` the output carries none.
    // Dimensions are read from the oriented output, not from metadata: a portrait
    // phone photo is often stored sideways, and metadata can lie.
    const oriented = () => base().rotate();
    const encoded =
      format === "png"
        ? await oriented().png().toBuffer({ resolveWithObject: true })
        : format === "webp"
          ? await oriented().webp({ quality: 92 }).toBuffer({ resolveWithObject: true })
          : await oriented().jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const { width, height } = encoded.info;
    if (Math.min(width, height) < limits.minDimension) return { ok: false, reason: `image smaller than ${limits.minDimension}px`, checksum };
    if (Math.max(width, height) > limits.maxDimension) return { ok: false, reason: `image larger than ${limits.maxDimension}px`, checksum };
    const master = {
      body: encoded.data,
      mimeType: (format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg") as ProcessedPhoto["master"]["mimeType"],
    };

    const variants = {} as Record<VariantName, Buffer>;
    for (const name of Object.keys(VARIANT_WIDTHS) as VariantName[]) {
      variants[name] = await oriented()
        .resize({ width: VARIANT_WIDTHS[name], withoutEnlargement: true, fit: "inside" })
        .webp({ quality: 80 })
        .toBuffer();
    }
    return { ok: true, checksum, width, height, master, variants, hadMetadata };
  } catch (error) {
    // Reason is for staff; it never contains file contents.
    const message = error instanceof Error ? error.message : "unreadable image";
    return { ok: false, reason: /pixel limit/i.test(message) ? "image has too many pixels" : "image could not be decoded", checksum };
  }
}
