/**
 * How speech becomes text for the intake assistant.
 *
 * Two routes, both on the existing Gemini key:
 *  - "asr": a dedicated transcription model, called with the SDK's documented
 *    `audioTranscriptionConfig` (BCP-47 `languageCodes`, `customVocabulary`,
 *    `mode`). Used when GEMINI_INTAKE_TRANSCRIBE_MODE=asr, or when the configured
 *    transcription model is a "*transcribe*" model.
 *  - "prompt": an audio prompt to a general Flash model that returns JSON. Always
 *    available, and the fallback when the dedicated route is refused.
 *
 * Both carry the language the agent chose (Ελληνικά -> el-GR, English -> en-US,
 * Αυτόματα -> both as hints) and a short, scoped list of real-estate words taken
 * from HOME88's own property types and field names, so terms like "μεζονέτα" or
 * "συντελεστής δόμησης" are recognised. Nothing about the recording is stored.
 */

import { ALL_LABELS_EL, PROPERTY_TYPES } from "./fields";
import type { Lang } from "./state";

export type LanguagePreference = "auto" | Lang;

export const LANGUAGE_CODES: Record<LanguagePreference, string[]> = {
  el: ["el-GR"],
  en: ["en-US"],
  // Hints, not a restriction: Greek agents mix English terms ("open plan", "parking").
  auto: ["el-GR", "en-US"],
};

/** Words agents use that a general recogniser often gets wrong. Short on purpose: the vocabulary biases, it does not teach. */
const TERMS = [
  "τετραγωνικά", "τετραγωνικά μέτρα", "τ.μ.", "εμβαδόν", "όροφος", "ισόγειο", "υπόγειο", "ημιυπόγειο", "ρετιρέ", "δώμα",
  "υπνοδωμάτια", "μπάνια", "WC", "ανελκυστήρας", "θέρμανση", "αυτόνομη θέρμανση", "κεντρική θέρμανση", "φυσικό αέριο",
  "ενεργειακή κλάση", "ΠΕΑ", "ανακαίνιση", "ανακαινισμένο", "νεόδμητο", "πρόσοψη", "συντελεστής δόμησης", "κάλυψη",
  "αρτιο και οικοδομήσιμο", "εντός σχεδίου", "εκτός σχεδίου", "αγροτεμάχιο", "κοινόχρηστα", "θέση στάθμευσης", "πιλοτή",
  "αποθήκη", "τζάκι", "κλιματισμός", "ηλιακός θερμοσίφωνας", "τιμή κατόπιν επικοινωνίας", "χιλιάδες ευρώ", "ευρώ τον μήνα",
  "πώληση", "ενοικίαση", "ανάθεση", "ΚΑΕΚ", "κτηματολόγιο", "τοπογραφικό",
];

/** The vocabulary sent with a recording: HOME88 property types, the most used field names, and agents' terms. At most 120 phrases. */
export function intakeVocabulary(): string[] {
  const types = PROPERTY_TYPES.map(([, el]) => el);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of [...types, ...TERMS, ...ALL_LABELS_EL]) {
    const w = word.trim();
    if (!w || w.length > 40 || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= 120) break;
  }
  return out;
}

/** The instruction for the prompt route. Numbers are written as digits so the agent can check them at a glance. */
export function transcriptionPrompt(preference: LanguagePreference, vocabulary: string[]): string {
  const language =
    preference === "el" ? "The speaker is speaking Greek (el-GR). Write Greek in Greek letters." :
    preference === "en" ? "The speaker is speaking English (en-US)." :
    "The speaker speaks Greek (el-GR), English (en-US), or both in the same sentence. Write Greek in Greek letters and English in Latin letters.";
  return [
    "You are a speech-to-text transcriber for a Greek real-estate agency. Transcribe the speech in this audio exactly as spoken.",
    language,
    "Do not translate, summarise, answer, correct the speaker, or add anything that was not said.",
    "Write numbers, prices, areas, floors and years as digits (e.g. 'ενενήντα πέντε τετραγωνικά' -> '95 τετραγωνικά', 'τριακόσιες πενήντα χιλιάδες ευρώ' -> '350.000 ευρώ', 'τρίτος όροφος' -> '3ος όροφος').",
    "Keep self-corrections as spoken (e.g. '400.000, όχι, 380.000 ευρώ').",
    `Words that may appear: ${vocabulary.join(", ")}.`,
    "If there is no intelligible speech, return an empty text.",
    'Reply as JSON: {"text": string, "language": "el" | "en"}.',
  ].join("\n");
}

/** Which language a transcript is in, from its letters. Used when the recogniser does not say. */
export function detectLanguage(text: string): Lang | null {
  const greek = (text.match(/[Ͱ-Ͽἀ-῿]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  if (greek + latin === 0) return null;
  // Greek agents drop English terms ("open plan", "parking") into Greek sentences: Greek letters count double.
  return greek * 2 >= latin ? "el" : "en";
}

export type TranscribeRoute = "asr" | "prompt";

export function routeFor(mode: string | undefined, model: string): TranscribeRoute {
  if (mode === "asr" || mode === "prompt") return mode;
  return /transcri/i.test(model) ? "asr" : "prompt";
}
