/**
 * Suggested labels for the photos an agent takes during an intake.
 *
 * The model looks at small previews and says what ROOM or VIEW each shows, from
 * a fixed list; nothing else it says is read. The labels are suggestions for
 * the agent to accept or change, and once accepted they become the photo's
 * alternative text. Previews are held in memory for the request: nothing is
 * stored or logged, and the model is told not to identify people or read text.
 */

export type PhotoLabelDef = { code: string; el: string; en: string };

export const PHOTO_LABELS: readonly PhotoLabelDef[] = [
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
];

export const PHOTO_LABEL_CODES = PHOTO_LABELS.map((l) => l.code);

export const MAX_LABEL_IMAGES = 12;
/** Previews are small by design (about 640 px); this bounds a request. */
export const MAX_LABEL_IMAGE_BYTES = 400_000;

export const LABEL_SYSTEM = [
  "You label real-estate photos. For each image say only which room or view it shows, choosing exactly one code from the allowed list.",
  "Do not identify or describe any person, do not read or repeat any text, number plate or address, and do not comment on condition, quality or price.",
  "If you cannot tell, use OTHER with low confidence. Answer only in the requested JSON.",
].join(" ");

export function labelJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, label: { type: "string", enum: PHOTO_LABEL_CODES }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
          required: ["id", "label", "confidence"],
        },
      },
    },
    required: ["labels"],
  };
}

export type PhotoLabelSuggestion = { id: string; label: string; labelEl: string; labelEn: string; confidence: "high" | "medium" | "low" };

/**
 * Keeps only what was asked for: one suggestion per requested image, a label from the
 * list, and `OTHER` / low where the model said nothing usable. Never trusts ids or codes from the model.
 */
export function parseLabels(raw: unknown, requested: readonly string[]): PhotoLabelSuggestion[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { labels?: unknown }).labels) ? ((raw as { labels: unknown[] }).labels) : [];
  const byId = new Map<string, { label: string; confidence: "high" | "medium" | "low" }>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, label, confidence } = item as { id?: unknown; label?: unknown; confidence?: unknown };
    if (typeof id !== "string" || !requested.includes(id) || byId.has(id)) continue;
    if (typeof label !== "string" || !PHOTO_LABEL_CODES.includes(label)) continue;
    byId.set(id, { label, confidence: confidence === "high" || confidence === "medium" ? confidence : "low" });
  }
  return requested.map((id) => {
    const found = byId.get(id) ?? { label: "OTHER", confidence: "low" as const };
    const def = PHOTO_LABELS.find((l) => l.code === found.label)!;
    return { id, label: def.code, labelEl: def.el, labelEn: def.en, confidence: found.confidence };
  });
}

/** The real type of an image from its first bytes; a preview whose bytes disagree with its declared type is refused. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
