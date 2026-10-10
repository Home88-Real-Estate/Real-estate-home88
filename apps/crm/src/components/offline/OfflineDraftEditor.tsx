"use client";

import { useEffect, useMemo, useState } from "react";
import { CORE_FIELDS, listingProfileFor, profileFor } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS } from "@home88/types";

import { Icon } from "@/components/Icon";
import { LocationPicker } from "@/components/intake/LocationPicker";
import { PendingMedia, type PendingFile } from "@/components/PendingMedia";
import { ActionButton } from "@/components/ui/ActionButton";
import { offlineStore, type FieldValue, type OfflineDraft } from "@/lib/offline-store";
import { localPhotoKey } from "@/lib/offline-sync";
import { notifyOffline } from "@/lib/offline-runtime";
import { photoStore } from "@/lib/pending-photos";

const MAX_PHOTO_BYTES = 26214400;
const PROPERTY_TYPES = Object.entries(PROPERTY_TYPE_LABELS).map(([value, l]) => ({ value, label: l.el }));
const LISTING_TYPES = Object.entries(LISTING_TYPE_LABELS).map(([value, l]) => ({ value, label: l.el }));

/** "350.000", "350 000", "95,5" → numbers; anything else is left for the server to refuse with a clear message. */
export function parseNumber(raw: string, integer: boolean): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!t) return null;
  const normalised = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.round(n) : n;
}

const show = (v: FieldValue | undefined) => (v === undefined || v === null ? "" : String(v));

/**
 * A property draft entered on this device, for when there is no signal: the essentials, notes for the
 * assistant, the location and photos. "Αποθήκευση στη συσκευή" keeps it here and queues what changed; the sync
 * takes it to the CRM when the connection is back, with the same checks the online assistant applies.
 */
export function OfflineDraftEditor({ initial, online, onDone }: { initial: OfflineDraft; online: boolean; onDone: (saved: OfflineDraft | null) => void }) {
  const [draft, setDraft] = useState<OfflineDraft>(initial);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial.fields).map(([k, v]) => [k, show(v)])));
  const [photos, setPhotos] = useState<PendingFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const photoKey = initial.sessionId ?? localPhotoKey(initial.localId);

  useEffect(() => {
    void photoStore.load(photoKey).then((stored) => setPhotos(stored));
  }, [photoKey]);

  const type = texts.propertyType || undefined;
  const listing = texts.listingType || "SALE";
  const priceKey = listingProfileFor(listing).priceField;
  const coreKeys = useMemo(() => (type ? profileFor(type).core.filter((k) => k !== "area" && CORE_FIELDS[k] && CORE_FIELDS[k]!.kind !== "text").slice(0, 6) : ["bedrooms", "bathrooms", "floor"]), [type]);

  const setText = (key: string, value: string) => setTexts((cur) => ({ ...cur, [key]: value }));

  /** The values the server will be asked to set; numbers are parsed here so a typo is caught before saving. */
  function collect(): { fields: Record<string, FieldValue>; bad: Record<string, string> } {
    const fields: Record<string, FieldValue> = {};
    const bad: Record<string, string> = {};
    const numeric = new Set(["price", "monthlyRent", "area", ...coreKeys]);
    for (const [key, raw] of Object.entries(texts)) {
      if (!raw.trim()) continue;
      if (key === "price" && priceKey !== "price") continue;
      if (key === "monthlyRent" && priceKey !== "monthlyRent") continue;
      if (numeric.has(key)) {
        const def = CORE_FIELDS[key];
        if (def?.kind === "select") {
          fields[key] = raw;
          continue;
        }
        const n = parseNumber(raw, def?.kind === "int");
        if (n === null) bad[key] = "Γράψτε αριθμό.";
        else fields[key] = n;
      } else fields[key] = raw.trim();
    }
    return { fields, bad };
  }

  async function save() {
    const { fields, bad } = collect();
    setErrors(bad);
    if (Object.keys(bad).length > 0) {
      setNote("Διορθώστε τα πεδία με κόκκινο πριν την αποθήκευση.");
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const photoResult = await photoStore.save(photoKey, photos);
      const saved = await offlineStore.save({ ...draft, fields }, photos.length > 0);
      setDraft(saved);
      notifyOffline();
      const { ops } = await offlineStore.get(saved.localId);
      const waiting = ops.filter((o) => o.status !== "done").length;
      setNote(
        `Αποθηκεύτηκε στη συσκευή · ${waiting} ${waiting === 1 ? "ενέργεια εκκρεμεί" : "ενέργειες εκκρεμούν"}.` +
          (photoResult === "saved" || photos.length === 0 ? "" : " Οι φωτογραφίες δεν χωρούν στη συσκευή: κρατήστε τη σελίδα ανοιχτή μέχρι τον συγχρονισμό.") +
          (online ? " Ο συγχρονισμός ξεκινά αυτόματα." : " Θα συγχρονιστεί μόλις επανέλθει η σύνδεση."),
      );
      onDone(saved);
    } catch {
      setNote("Ο browser δεν επιτρέπει αποθήκευση σε αυτή τη συσκευή (ιδιωτική περιήγηση;). Μην κλείσετε τη σελίδα.");
    } finally {
      setSaving(false);
    }
  }

  const field = (key: string, label: string, opts: { unit?: string; inputMode?: "numeric" | "decimal" | "text"; placeholder?: string } = {}) => (
    <div className="field" key={key}>
      <label htmlFor={`off-${key}`}>{label}{opts.unit ? ` (${opts.unit})` : ""}</label>
      <input id={`off-${key}`} className="input" inputMode={opts.inputMode} placeholder={opts.placeholder} value={texts[key] ?? ""} onChange={(e) => setText(key, e.target.value)} aria-invalid={Boolean(errors[key]) || undefined} />
      {errors[key] && <span className="error">{errors[key]}</span>}
    </div>
  );

  return (
    <div className="offline-editor">
      <div className="xalert xalert--info">
        <Icon name="cloudOff" size={18} />
        <span>
          {draft.sessionId
            ? "Συνεχίζετε μια καταχώριση του CRM σε αυτή τη συσκευή. Οι αλλαγές σας στέλνονται μόλις υπάρξει σύνδεση· αν κάποιος άλλος άλλαξε το ίδιο στοιχείο στο μεταξύ, θα σας ζητηθεί να διαλέξετε."
            : "Νέα καταχώριση σε αυτή τη συσκευή. Ό,τι αποθηκεύσετε εδώ στέλνεται στο CRM μόλις υπάρξει σύνδεση."}
        </span>
      </div>

      <section className="xcard ipanel">
        <h3>Είδος & τύπος</h3>
        <div className="offline-grid">
          <div className="field">
            <label htmlFor="off-listingType">Είδος αγγελίας</label>
            <select id="off-listingType" className="select" value={texts.listingType ?? ""} onChange={(e) => setText("listingType", e.target.value)}>
              <option value="">—</option>
              {LISTING_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="off-propertyType">Τύπος ακινήτου</label>
            <select id="off-propertyType" className="select" value={texts.propertyType ?? ""} onChange={(e) => setText("propertyType", e.target.value)}>
              <option value="">—</option>
              {PROPERTY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="xcard ipanel">
        <h3>Τιμή, τοποθεσία, εμβαδόν</h3>
        <div className="offline-grid">
          {field(priceKey, priceKey === "price" ? "Τιμή" : "Μηνιαίο μίσθωμα", { unit: "€", inputMode: "decimal", placeholder: priceKey === "price" ? "π.χ. 350.000" : "π.χ. 900" })}
          {field("area", "Εμβαδόν", { unit: "m²", inputMode: "decimal" })}
          {field("areaName", "Περιοχή", { placeholder: "π.χ. Γλυφάδα" })}
          {field("city", "Πόλη / Δήμος")}
          {field("address", "Διεύθυνση (δεν δημοσιεύεται)")}
          {coreKeys.map((k) => {
            const def = CORE_FIELDS[k]!;
            if (def.kind === "select") {
              return (
                <div className="field" key={k}>
                  <label htmlFor={`off-${k}`}>{def.label}</label>
                  <select id={`off-${k}`} className="select" value={texts[k] ?? ""} onChange={(e) => setText(k, e.target.value)}>
                    <option value="">—</option>
                    {def.options?.map(([value, l]) => <option key={value} value={value}>{l}</option>)}
                  </select>
                </div>
              );
            }
            return field(k, def.label, { unit: def.unit, inputMode: def.kind === "int" ? "numeric" : "decimal" });
          })}
        </div>
      </section>

      <section className="xcard ipanel">
        <h3>Σημειώσεις για τον βοηθό</h3>
        <p className="hint">Γράψτε ελεύθερα ό,τι βλέπετε. Μόλις υπάρξει σύνδεση στέλνονται στον βοηθό, που συμπληρώνει τα πεδία· τα στοιχεία που γράψατε παραπάνω δεν αλλάζουν χωρίς τη δική σας επιβεβαίωση.</p>
        {draft.sentNotes.length > 0 && <ul className="offline-sent">{draft.sentNotes.map((n, i) => <li key={i}><Icon name="check" size={14} /> {n}</li>)}</ul>}
        <label htmlFor="off-notes" className="sr-only">Σημειώσεις</label>
        <textarea id="off-notes" className="textarea" rows={4} value={draft.notes} placeholder="π.χ. Ρετιρέ με μεγάλη βεράντα και θέα θάλασσα, ανακαινισμένο το 2020." onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
      </section>

      <section className="xcard ipanel">
        <h3>Τίτλος και περιγραφή (προαιρετικά)</h3>
        <p className="hint">Αν τα γράψετε εδώ, μετρούν ως δικά σας. Αλλιώς ο βοηθός θα προτείνει κείμενα, που εγκρίνετε στο CRM.</p>
        {field("titleEl", "Τίτλος (ελληνικά)")}
        <div className="field">
          <label htmlFor="off-descriptionEl">Περιγραφή (ελληνικά)</label>
          <textarea id="off-descriptionEl" className="textarea" rows={4} value={texts.descriptionEl ?? ""} onChange={(e) => setText("descriptionEl", e.target.value)} />
        </div>
      </section>

      <section className="xcard ipanel">
        <h3>Θέση</h3>
        <LocationPicker value={draft.location} online={online} onChange={(location) => setDraft((d) => ({ ...d, location }))} />
      </section>

      <section className="xcard ipanel">
        <h3>Φωτογραφίες</h3>
        <PendingMedia files={photos} onChange={setPhotos} maxBytes={MAX_PHOTO_BYTES} camera disabled={saving} />
        <p className="hint">Κρατιούνται σε αυτή τη συσκευή και διαγράφονται από εδώ μόνο αφού ανέβει και επιβεβαιωθεί η καθεμία.</p>
      </section>

      <label className="check offline-create">
        <input type="checkbox" checked={draft.createWhenSynced} onChange={(e) => setDraft((d) => ({ ...d, createWhenSynced: e.target.checked }))} />
        <span>Αποθήκευση ως πρόχειρο ακίνητο μόλις συγχρονιστεί (αν είναι αρκετά πλήρες· αλλιώς μένει πρόχειρο στο CRM για να το ολοκληρώσετε).</span>
      </label>

      {note && <p className="xalert" role="status"><Icon name="info" size={18} /><span>{note}</span></p>}
      <div className="offline-actions">
        <ActionButton variant="ghost" icon="arrowLeft" onClick={() => onDone(null)} disabled={saving}>Πίσω στη λίστα</ActionButton>
        <ActionButton variant="primary" icon="save" loading={saving} loadingLabel="Αποθήκευση…" onClick={() => void save()}>Αποθήκευση στη συσκευή</ActionButton>
      </div>
    </div>
  );
}
