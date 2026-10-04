/**
 * Upload orchestration for property media, independent of the DOM so it can
 * be unit-tested with fake I/O.
 *
 * For each file: ask the API for signed URLs → PUT the original (and, for
 * photos, a browser-made preview and thumbnail) straight to object storage →
 * confirm with the API. Every step retries with backoff and waits for the
 * connection to come back, so a dropped mobile signal pauses an upload rather
 * than losing it. Confirm is idempotent on the API side, so a retried confirm
 * cannot create a duplicate row.
 */

export type SignedPut = { url: string; headers: Record<string, string> };

export type UploadTicket = {
  storageKey: string;
  upload: SignedPut;
  variants: Partial<Record<"preview" | "thumbnail", SignedPut & { storageKey: string }>>;
};

export type Variants = { preview: Blob; thumbnail: Blob } | null;

export type UploadIO = {
  requestTicket(input: {
    fileName: string;
    mimeType: string;
    byteSize: number;
    kind?: string;
    withVariants: boolean;
  }): Promise<UploadTicket>;
  put(target: SignedPut, body: Blob, onProgress?: (fraction: number) => void): Promise<void>;
  confirm(input: {
    storageKey: string;
    fileName: string;
    kind?: string;
    hasPreview: boolean;
    hasThumbnail: boolean;
  }): Promise<{ mediaId?: string } | void>;
  makeVariants(file: File): Promise<Variants>;
  /** Resolves when the device is (back) online. */
  waitForOnline(): Promise<void>;
  sleep(ms: number): Promise<void>;
};

/** An error the user has to fix (bad type, too large, no permission): no retry. */
export class PermanentUploadError extends Error {}

export type UploadState = "queued" | "preparing" | "uploading" | "confirming" | "done" | "failed";

export type UploadUpdate = { state: UploadState; progress: number; message?: string; mediaId?: string };

export async function withRetry<T>(
  io: Pick<UploadIO, "waitForOnline" | "sleep">,
  task: () => Promise<T>,
  { attempts = 5, baseMs = 1000 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await io.waitForOnline();
    try {
      return await task();
    } catch (error) {
      if (error instanceof PermanentUploadError) throw error;
      lastError = error;
      if (attempt < attempts - 1) await io.sleep(baseMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Same file picked twice in one session (name, size and modified time). */
export function fileFingerprint(file: Pick<File, "name" | "size" | "lastModified">): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function uploadOne(
  io: UploadIO,
  file: File,
  kind: string | undefined,
  update: (u: UploadUpdate) => void,
): Promise<void> {
  update({ state: "preparing", progress: 0 });
  const isPhoto = file.type.startsWith("image/") && file.type !== "image/svg+xml" && kind !== "FLOOR_PLAN";
  const variants = isPhoto ? await io.makeVariants(file).catch(() => null) : null;

  const ticket = await withRetry(io, () =>
    io.requestTicket({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      kind,
      withVariants: variants !== null,
    }),
  );

  update({ state: "uploading", progress: 0 });
  await withRetry(io, () =>
    io.put(ticket.upload, file, (fraction) => update({ state: "uploading", progress: fraction })),
  );

  let hasPreview = false;
  let hasThumbnail = false;
  if (variants) {
    // Variants are a convenience: if one cannot be uploaded the original
    // still counts, and the site falls back to it.
    if (ticket.variants.preview) {
      hasPreview = await withRetry(io, () => io.put(ticket.variants.preview!, variants.preview), {
        attempts: 3,
      }).then(
        () => true,
        () => false,
      );
    }
    if (ticket.variants.thumbnail) {
      hasThumbnail = await withRetry(io, () => io.put(ticket.variants.thumbnail!, variants.thumbnail), {
        attempts: 3,
      }).then(
        () => true,
        () => false,
      );
    }
  }

  update({ state: "confirming", progress: 1 });
  const confirmed = await withRetry(io, () =>
    io.confirm({ storageKey: ticket.storageKey, fileName: file.name, kind, hasPreview, hasThumbnail }),
  );
  update({ state: "done", progress: 1, mediaId: confirmed ? confirmed.mediaId : undefined });
}

/** Runs uploads with limited parallelism; one failure does not stop the rest. */
export async function uploadAll(
  io: UploadIO,
  files: File[],
  kind: string | undefined,
  update: (index: number, u: UploadUpdate) => void,
  concurrency = 2,
): Promise<{ done: number; failed: number }> {
  let next = 0;
  let done = 0;
  let failed = 0;
  files.forEach((_, index) => update(index, { state: "queued", progress: 0 }));

  async function worker(): Promise<void> {
    while (next < files.length) {
      const index = next;
      next += 1;
      try {
        await uploadOne(io, files[index]!, kind, (u) => update(index, u));
        done += 1;
      } catch (error) {
        failed += 1;
        update(index, {
          state: "failed",
          progress: 0,
          message: error instanceof Error ? error.message : "Η μεταφόρτωση απέτυχε.",
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { done, failed };
}
