/**
 * The assistant's words, in Greek and English.
 *
 * Every reply is assembled from templates and the captured values: the model
 * is never asked to write the conversation, so the assistant cannot state a
 * fact the agent did not give. (The only generated prose in this feature is
 * the listing title/description suggestion, which is shown for approval.)
 */

import type { FieldSpec } from "./fields";
import type { Lang, Pending, Value } from "./state";

type L<T = string> = { el: T; en: T };
const t = (l: L, lang: Lang) => l[lang];

const QUESTIONS: Record<string, L> = {
  listingType: { el: "Πρόκειται για πώληση, ενοικίαση ή ανάθεση;", en: "Is this for sale, for rent, or an assignment?" },
  propertyType: { el: "Τι τύπος ακινήτου είναι; Για παράδειγμα διαμέρισμα, μονοκατοικία ή οικόπεδο.", en: "What type of property is it? For example an apartment, a house or a plot." },
  price: { el: "Ποια είναι η ζητούμενη τιμή;", en: "What is the asking price?" },
  monthlyRent: { el: "Ποιο είναι το μηνιαίο μίσθωμα;", en: "What is the monthly rent?" },
  area: { el: "Πόσα τετραγωνικά είναι;", en: "How many square metres is it?" },
  areaName: { el: "Σε ποια περιοχή βρίσκεται;", en: "Which area is it in?" },
  plotArea: { el: "Πόσα τετραγωνικά είναι το οικόπεδο;", en: "How large is the plot in square metres?" },
  city: { el: "Σε ποια πόλη ή δήμο βρίσκεται;", en: "Which city or municipality is it in?" },
  bedrooms: { el: "Πόσα υπνοδωμάτια έχει;", en: "How many bedrooms does it have?" },
  bathrooms: { el: "Πόσα μπάνια έχει;", en: "How many bathrooms does it have?" },
  floor: { el: "Σε ποιον όροφο βρίσκεται;", en: "Which floor is it on?" },
  totalFloors: { el: "Πόσους ορόφους έχει το κτίριο;", en: "How many floors does the building have?" },
  yearBuilt: { el: "Ποιο είναι το έτος κατασκευής;", en: "What is the year of construction?" },
  heating: { el: "Τι θέρμανση έχει;", en: "What kind of heating does it have?" },
  energyClass: { el: "Ποια είναι η ενεργειακή κλάση;", en: "What is the energy class?" },
  parkingSpaces: { el: "Πόσες θέσεις στάθμευσης έχει;", en: "How many parking spaces does it have?" },
  condition: { el: "Σε τι κατάσταση βρίσκεται;", en: "What condition is it in?" },
};


export function pickLanguage(preference: "auto" | Lang, detected: Lang | null, previous: Lang): Lang {
  return preference !== "auto" ? preference : detected ?? previous;
}

const num = (lang: Lang, n: number) => new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 2 }).format(n);

export function label(spec: FieldSpec, lang: Lang): string {
  return lang === "el" ? spec.labelEl : spec.labelEn;
}

export function valueText(spec: FieldSpec, value: Value, lang: Lang): string {
  if (typeof value === "boolean") return value ? (lang === "el" ? "Ναι" : "Yes") : lang === "el" ? "Όχι" : "No";
  if (spec.kind === "select") {
    const o = spec.options?.find((x) => x.value === value);
    return o ? (lang === "en" ? o.labelEn ?? o.labelEl : o.labelEl) : String(value);
  }
  if (typeof value === "number") {
    // A year is a label, not a quantity: 1998, never "1.998".
    if (/year/i.test(spec.key)) return String(value);
    if (spec.unit === "€") return `€${num(lang, value)}`;
    return spec.unit ? `${num(lang, value)} ${spec.unit}` : num(lang, value);
  }
  return String(value);
}

export function questionFor(spec: FieldSpec, lang: Lang): string {
  const known = QUESTIONS[spec.key];
  if (known) return t(known, lang);
  const name = label(spec, lang);
  if (spec.kind === "bool") return lang === "el" ? `Υπάρχει: ${name};` : `Does it have: ${name}?`;
  if (spec.kind === "select" && spec.options) {
    const list = spec.options.map((o) => (lang === "en" ? o.labelEn ?? o.labelEl : o.labelEl)).join(", ");
    return lang === "el" ? `${name}; Επιλογές: ${list}.` : `${name}? Options: ${list}.`;
  }
  return lang === "el" ? `${name}: ποια είναι η τιμή;` : `What is the ${name}?`;
}

/** How a captured value is said in a sentence; fields without a phrase fall back to "Label value". */
function phrase(spec: FieldSpec, value: Value, lang: Lang): string {
  const v = valueText(spec, value, lang);
  const el = lang === "el";
  switch (spec.key) {
    case "propertyType": return v.toLowerCase();
    case "listingType": return value === "SALE" ? (el ? "προς πώληση" : "for sale") : value === "RENT" ? (el ? "προς ενοικίαση" : "for rent") : el ? `είδος: ${v.toLowerCase()}` : `type: ${v.toLowerCase()}`;
    case "area": case "plotArea": case "builtArea": {
      const size = typeof value === "number" ? `${num(lang, value)} ${el ? "τ.μ." : "sqm"}` : v;
      return spec.key === "area" ? size : `${label(spec, lang).toLowerCase()} ${size}`;
    }
    case "areaName": case "city": return el ? `περιοχή ${v}` : `in ${v}`;
    case "floor": return typeof value === "number" ? (value === 0 ? (el ? "ισόγειο" : "ground floor") : el ? `${value}ος όροφος` : `floor ${value}`) : `${label(spec, lang)} ${v}`;
    case "bedrooms": return el ? `${v} ${value === 1 ? "υπνοδωμάτιο" : "υπνοδωμάτια"}` : `${v} bedroom${value === 1 ? "" : "s"}`;
    case "bathrooms": return el ? `${v} ${value === 1 ? "μπάνιο" : "μπάνια"}` : `${v} bathroom${value === 1 ? "" : "s"}`;
    case "price": return el ? `τιμή ${v}` : `price ${v}`;
    case "monthlyRent": return el ? `μίσθωμα ${v} τον μήνα` : `rent ${v} a month`;
    default:
      if (typeof value === "boolean") return value ? label(spec, lang).toLowerCase() : el ? `χωρίς ${label(spec, lang).toLowerCase()}` : `no ${label(spec, lang).toLowerCase()}`;
      return `${label(spec, lang)} ${v}`;
  }
}

/** "Ωραία, κατέγραψα: διαμέρισμα προς πώληση, περιοχή Γλυφάδα, 95 τ.μ., 3ος όροφος, 2 υπνοδωμάτια, τιμή €350.000." Only what was applied this turn. */
export function acknowledge(applied: Array<{ key: string; value: Value; previous?: Value }>, specs: FieldSpec[], lang: Lang): string | null {
  if (applied.length === 0) return null;
  const order = ["propertyType", "listingType", "areaName", "city", "area", "floor", "bedrooms", "bathrooms", "price", "monthlyRent"];
  const sorted = [...applied].sort((a, b) => (order.indexOf(a.key) + 100) % 100 - (order.indexOf(b.key) + 100) % 100);
  const parts = sorted.flatMap((a) => {
    const spec = specs.find((s) => s.key === a.key);
    if (!spec) return [];
    const said = phrase(spec, a.value, lang);
    return [a.previous !== undefined ? (lang === "el" ? `${said} (αντί για ${valueText(spec, a.previous, lang)})` : `${said} (instead of ${valueText(spec, a.previous, lang)})`) : said];
  });
  if (parts.length === 0) return null;
  const corrected = applied.some((a) => a.previous !== undefined);
  if (lang === "el") return `${corrected ? "Το διόρθωσα" : "Ωραία, κατέγραψα"}: ${parts.join(", ")}.`;
  return `${corrected ? "Corrected" : "Great, I've noted"}: ${parts.join(", ")}.`;
}

export function confirmQuestion(p: Pending, spec: FieldSpec, lang: Lang): string {
  const name = label(spec, lang);
  const proposed = valueText(spec, p.proposed, lang);
  if (p.reason === "conflict" && p.current !== undefined) {
    const current = valueText(spec, p.current, lang);
    return lang === "el"
      ? `Είχατε πει ${name}: ${current}. Να το αλλάξω σε ${proposed};`
      : `You told me ${name}: ${current}. Should I change it to ${proposed}?`;
  }
  return lang === "el" ? `Δεν είμαι σίγουρος: ${name} ${proposed}. Είναι σωστό;` : `I'm not sure: ${name} ${proposed}. Is that right?`;
}

export function skippedNote(spec: FieldSpec, lang: Lang): string {
  return lang === "el" ? `Εντάξει, αφήνω το «${label(spec, lang)}» κενό.` : `OK, I'll leave "${label(spec, lang)}" empty.`;
}

export const REPLY = {
  greeting: { el: "Πείτε μου λίγα λόγια για το ακίνητο: τύπο, περιοχή, τιμή και ό,τι γνωρίζετε. Μπορείτε να μιλήσετε ή να γράψετε, στα ελληνικά ή στα αγγλικά.", en: "Tell me about the property: the type, the area, the price and whatever you know. You can speak or type, in Greek or English." } as L,
  review: { el: "Έχω ό,τι χρειάζομαι. Ελέγξτε τη σύνοψη, διορθώστε ό,τι θέλετε και αποθηκεύστε το πρόχειρο. Δεν θα δημοσιευτεί πουθενά.", en: "I have what I need. Check the summary, correct anything, and save the draft. It will not be published anywhere." } as L,
  undone: { el: "Το επανέφερα.", en: "Done, I've undone that." } as L,
  nothingToUndo: { el: "Δεν υπάρχει κάτι να επαναφέρω.", en: "There is nothing to undo." } as L,
  photosLater: { el: "Εντάξει, μπορείτε να προσθέσετε φωτογραφίες αργότερα από το ακίνητο.", en: "OK, you can add photos later from the property page." } as L,
  muted: { el: "Σίγαση ενεργή. Συνεχίζω γραπτά.", en: "Muted. I'll continue in text." } as L,
  unmuted: { el: "Η φωνή ενεργοποιήθηκε.", en: "Voice replies are back on." } as L,
  noChange: { el: "Δεν κατάλαβα κάποια πληροφορία για το ακίνητο. Μπορείτε να το πείτε αλλιώς;", en: "I didn't catch any property detail. Could you say it another way?" } as L,
  missingIntro: { el: "Λείπουν ακόμη:", en: "Still missing:" } as L,
  nothingMissing: { el: "Δεν λείπει κάτι σημαντικό.", en: "Nothing important is missing." } as L,
  languageSet: { el: "Εντάξει, θα απαντώ στα ελληνικά.", en: "OK, I'll reply in English." } as L,
};

export function reply(key: keyof typeof REPLY, lang: Lang): string {
  return t(REPLY[key], lang);
}

export function composeReply(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(" ");
}

/** For tests and logs: which keys the replies know by name. */
export const KNOWN_QUESTION_KEYS = Object.keys(QUESTIONS);
