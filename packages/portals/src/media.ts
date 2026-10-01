import type { MediaKind, PortalMedia } from "./types";

/** Resolves an object-storage key to a public URL. */
export function resolveMediaUrl(storageKey: string, mediaBaseUrl?: string | null): string {
  if (/^https?:\/\//i.test(storageKey)) return storageKey;
  const base = (mediaBaseUrl ?? "").replace(/\/+$/, "");
  const key = storageKey.replace(/^\/+/, "");
  return base ? `${base}/${key}` : `/media/${key}`;
}

/** Primary photo first, then by the order a human arranged them. */
export function sortMedia(media: PortalMedia[]): PortalMedia[] {
  return [...media].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

export function mediaOfKind(media: PortalMedia[], kind: MediaKind): PortalMedia[] {
  return sortMedia(media).filter((item) => item.kind === kind);
}
