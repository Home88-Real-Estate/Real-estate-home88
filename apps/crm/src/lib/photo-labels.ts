/** The room labels the assistant can suggest for a photo. Same list as the server's (apps/api/src/lib/property-intake/photo-labels.ts). */

export const PHOTO_LABELS = [
  { code: "EXTERIOR", el: "Εξωτερική όψη", en: "Exterior" },
  { code: "LIVING_ROOM", el: "Σαλόνι", en: "Living room" },
  { code: "KITCHEN", el: "Κουζίνα", en: "Kitchen" },
  { code: "BEDROOM", el: "Υπνοδωμάτιο", en: "Bedroom" },
  { code: "BATHROOM", el: "Μπάνιο", en: "Bathroom" },
  { code: "BALCONY", el: "Μπαλκόνι / βεράντα", en: "Balcony / terrace" },
  { code: "VIEW", el: "Θέα", en: "View" },
  { code: "GARDEN", el: "Κήπος", en: "Garden" },
  { code: "POOL", el: "Πισίνα", en: "Pool" },
  { code: "PARKING", el: "Χώρος στάθμευσης", en: "Parking" },
  { code: "ENTRANCE", el: "Είσοδος / κλιμακοστάσιο", en: "Entrance / stairwell" },
  { code: "FLOOR_PLAN", el: "Κάτοψη", en: "Floor plan" },
  { code: "OTHER", el: "Άλλο", en: "Other" },
] as const;

export type PhotoLabelCode = (typeof PHOTO_LABELS)[number]["code"];

/** A suggestion the agent has not yet accepted, or a label the agent chose. */
export type PhotoLabel = { code: PhotoLabelCode; confidence: "high" | "medium" | "low" | "agent"; accepted: boolean };

export const isLabelCode = (value: string): value is PhotoLabelCode => PHOTO_LABELS.some((l) => l.code === value);

/** Alternative text for the gallery, in both languages, for an accepted label. "Other" says nothing, so it sets no text. */
export function altTextFor(code: PhotoLabelCode): { altEl: string; altEn: string } | null {
  if (code === "OTHER") return null;
  const l = PHOTO_LABELS.find((x) => x.code === code)!;
  return { altEl: l.el, altEn: l.en };
}

/** Scale a width x height to fit within `max` on its long edge, never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Which accepted labels become alt text for which uploaded photo; photos with no accepted label are skipped. */
export function altUpdates(
  photos: Array<{ id: string }>,
  labels: Record<string, PhotoLabel | undefined>,
  mediaIdOf: (photoId: string) => string | undefined,
): Array<{ mediaId: string; altEl: string; altEn: string }> {
  const out: Array<{ mediaId: string; altEl: string; altEn: string }> = [];
  for (const p of photos) {
    const label = labels[p.id];
    const mediaId = mediaIdOf(p.id);
    const alt = label?.accepted ? altTextFor(label.code) : null;
    if (mediaId && alt) out.push({ mediaId, ...alt });
  }
  return out;
}
