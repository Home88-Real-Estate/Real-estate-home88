/**
 * Rules for files a visitor uploads.
 *
 * The browser's declared type and filename are claims, never facts. A file is
 * accepted only when the declared type is on the allow-list, the extension fits
 * that type, and (once stored) the leading bytes really are that format. Limits
 * are configuration so an operator can tighten them without a release.
 */

export type UploadKind = "PHOTO" | "DOCUMENT";

export const PUBLIC_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const PUBLIC_DOCUMENT_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

const EXTENSIONS: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

/** Anything executable or active, anywhere in the name (`photo.php.jpg` is refused too). */
const BLOCKED_SEGMENTS = new Set([
  "exe", "dll", "bat", "cmd", "com", "msi", "scr", "sh", "bash", "zsh", "ps1", "vbs", "js", "mjs", "cjs", "jar",
  "php", "phtml", "asp", "aspx", "jsp", "py", "pl", "rb", "html", "htm", "xhtml", "svg", "xml", "swf", "apk", "app",
]);

export type UploadLimits = {
  maxPhotos: number;
  maxDocuments: number;
  maxPhotoBytes: number;
  maxDocumentBytes: number;
  maxTotalBytes: number;
  /** Decoded pixel budget; stops a small file that expands to gigabytes. */
  maxPixels: number;
  minDimension: number;
  maxDimension: number;
};

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxPhotos: 20,
  maxDocuments: 5,
  maxPhotoBytes: 15 * 1024 * 1024,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxTotalBytes: 150 * 1024 * 1024,
  maxPixels: 80_000_000,
  minDimension: 300,
  maxDimension: 12_000,
};

export function uploadLimitsFromEnv(env: Record<string, string | undefined>): UploadLimits {
  const int = (key: string, fallback: number) => {
    const n = Number(env[key]);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const d = DEFAULT_UPLOAD_LIMITS;
  return {
    maxPhotos: int("INTAKE_MAX_PHOTOS", d.maxPhotos),
    maxDocuments: int("INTAKE_MAX_DOCUMENTS", d.maxDocuments),
    maxPhotoBytes: int("INTAKE_MAX_PHOTO_BYTES", d.maxPhotoBytes),
    maxDocumentBytes: int("INTAKE_MAX_DOCUMENT_BYTES", d.maxDocumentBytes),
    maxTotalBytes: int("INTAKE_MAX_TOTAL_BYTES", d.maxTotalBytes),
    maxPixels: int("INTAKE_MAX_PIXELS", d.maxPixels),
    minDimension: int("INTAKE_MIN_DIMENSION", d.minDimension),
    maxDimension: int("INTAKE_MAX_DIMENSION", d.maxDimension),
  };
}

export function extensionOf(fileName: string): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : null;
}

export type Declaration = { kind: UploadKind; mimeType: string; fileName: string; byteSize: number };

export type FileIssue = { code: "TYPE_NOT_ALLOWED" | "EXTENSION_MISMATCH" | "BLOCKED_NAME" | "TOO_LARGE" | "EMPTY"; message: string };

/** First check, before any signed URL is issued. */
export function checkDeclaration(declared: Declaration, limits: UploadLimits): FileIssue | null {
  const mime = declared.mimeType.split(";")[0]!.trim().toLowerCase();
  const allowed: readonly string[] = declared.kind === "PHOTO" ? PUBLIC_PHOTO_MIME : PUBLIC_DOCUMENT_MIME;
  if (!allowed.includes(mime)) {
    return { code: "TYPE_NOT_ALLOWED", message: declared.kind === "PHOTO" ? "Επιτρέπονται μόνο φωτογραφίες JPG, PNG ή WEBP." : "Επιτρέπονται μόνο PDF, JPG ή PNG." };
  }
  const segments = declared.fileName.toLowerCase().split(".").slice(1);
  if (segments.some((s) => BLOCKED_SEGMENTS.has(s))) {
    return { code: "BLOCKED_NAME", message: "Το όνομα του αρχείου δεν είναι αποδεκτό." };
  }
  const ext = extensionOf(declared.fileName);
  if (!ext || !EXTENSIONS[mime]?.includes(ext)) {
    return { code: "EXTENSION_MISMATCH", message: "Η κατάληξη του αρχείου δεν ταιριάζει με τον τύπο του." };
  }
  if (declared.byteSize <= 0) return { code: "EMPTY", message: "Το αρχείο είναι κενό." };
  const max = declared.kind === "PHOTO" ? limits.maxPhotoBytes : limits.maxDocumentBytes;
  if (declared.byteSize > max) return { code: "TOO_LARGE", message: `Το αρχείο υπερβαίνει το όριο ${Math.floor(max / 1024 / 1024)} MB.` };
  return null;
}

/** The format the bytes actually are, or null when unrecognised. */
export function sniffMime(head: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

/** Declared type must equal the sniffed type. A renamed file fails here. */
export function contentMatchesDeclaration(head: Uint8Array, declaredMime: string): boolean {
  return sniffMime(head) === declaredMime.split(";")[0]!.trim().toLowerCase();
}

/** Randomised, extension-from-type storage name; the visitor's name is never used. */
export function quarantineKey(prefix: string, uuid: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "pdf";
  return `submissions/${prefix}/uploads/${uuid}.${ext}`;
}

export function isQuarantineKeyFor(key: string, prefix: string): boolean {
  if (!/^[a-f0-9]{32}$/.test(prefix)) return false;
  return new RegExp(`^submissions/${prefix}/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp|pdf)$`).test(key);
}

export function displayFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base.replace(/[^\p{L}\p{N}_.\- ]+/gu, "_").trim().slice(0, 120);
  return cleaned || "αρχείο";
}
