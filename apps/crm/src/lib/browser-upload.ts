"use client";

import { CRM_BASE_PATH } from "@/lib/paths";
import { PermanentUploadError, type SignedPut, type UploadIO } from "@/lib/upload-queue";

/** Long edge of the browser-made web version and thumbnail of a photo. */
const PREVIEW_EDGE = 2048;
const THUMBNAIL_EDGE = 480;

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    if (response.status >= 500) console.error("Upload API error", response.status, url, data?.error);
    const message =
      data?.error?.code === "storage_unavailable"
        ? "Ο χώρος αποθήκευσης αρχείων δεν έχει ρυθμιστεί. Ενημερώστε τον διαχειριστή."
        : response.status === 413
          ? "Το αρχείο υπερβαίνει το επιτρεπόμενο μέγεθος."
          : (data?.error?.message ?? `Σφάλμα ${response.status}`);
    // 4xx (except timeouts and rate limits) will not get better by retrying.
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    throw retryable ? new Error(message) : new PermanentUploadError(message);
  }
  return data;
}

function putWithProgress(target: SignedPut, body: Blob, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      console.error("Storage PUT failed", xhr.status, xhr.responseText.slice(0, 300));
      const error = new Error(`Ο χώρος αποθήκευσης απέρριψε το αρχείο (${xhr.status}).`);
      reject(xhr.status === 403 || xhr.status === 400 ? new PermanentUploadError(error.message) : error);
    };
    // A blocked cross-origin PUT (bucket CORS) and a dropped connection look the
    // same to the page; the console carries the browser's own explanation.
    xhr.onerror = () => {
      console.error("Storage PUT did not complete: network error or the bucket's CORS rules do not allow this origin.", new URL(target.url).origin);
      reject(new Error("Δεν ήταν δυνατή η σύνδεση με τον χώρο αποθήκευσης."));
    };
    xhr.ontimeout = () => reject(new Error("Λήξη χρόνου"));
    xhr.send(body);
  });
}

async function resizeToJpeg(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))), "image/jpeg", quality),
  );
}

export function browserIO(propertyId: string): UploadIO {
  const base = `${CRM_BASE_PATH}/api/properties/${encodeURIComponent(propertyId)}/media`;
  return {
    requestTicket: (input) => postJson(`${base}/uploads`, input) as ReturnType<UploadIO["requestTicket"]>,
    put: putWithProgress,
    confirm: async (input) => {
      const data = (await postJson(`${base}/confirm`, input)) as { media?: { id?: string } } | null;
      return { mediaId: data?.media?.id };
    },
    async makeVariants(file) {
      // Honours EXIF orientation, so phone photos are not stored sideways.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      try {
        return {
          preview: await resizeToJpeg(bitmap, PREVIEW_EDGE, 0.85),
          thumbnail: await resizeToJpeg(bitmap, THUMBNAIL_EDGE, 0.8),
        };
      } finally {
        bitmap.close();
      }
    },
    waitForOnline: () =>
      navigator.onLine
        ? Promise.resolve()
        : new Promise((resolve) => window.addEventListener("online", () => resolve(), { once: true })),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}


/**
 * Stores the agent's order (sortOrder = position) and makes the first item the
 * cover, so the gallery matches what the form showed even when a retried file
 * was recorded last.
 */
export async function persistOrder(propertyId: string, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const base = `${CRM_BASE_PATH}/api/properties/${encodeURIComponent(propertyId)}/media`;
  await postJson(`${base}/reorder`, { ids: mediaIds });
  const response = await fetch(`${base}/${encodeURIComponent(mediaIds[0]!)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ isPrimary: true }),
  });
  if (!response.ok) throw new Error(`Σφάλμα ${response.status}`);
}
