"use client";

import { useActionState } from "react";
import { REQUEST_FEATURES, fieldDef } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { saveRequest } from "@/actions/work";
import { idleState } from "@/lib/form";

type Initial = {
  id?: string;
  listingType?: string;
  propertyTypes?: string[];
  areas?: string[];
  minPrice?: unknown;
  maxPrice?: unknown;
  minArea?: unknown;
  maxArea?: unknown;
  minBedrooms?: number | null;
  minBathrooms?: number | null;
  minFloor?: number | null;
  minYearBuilt?: number | null;
  features?: string[];
  clientName?: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
  rating?: number | null;
  notes?: string | null;
  expiresAt?: string | null;
};

const TYPE_GROUPS: Array<[string, string[]]> = [
  ["Κατοικία", ["APARTMENT", "STUDIO", "MAISONETTE", "HOUSE", "VILLA"]],
  ["Επαγγελματικό", ["OFFICE", "SHOP", "WAREHOUSE", "BUILDING", "HOTEL", "INDUSTRIAL"]],
  ["Γη και λοιπά", ["LAND", "PLOT", "PARKING", "OTHER"]],
];

const v = (x: unknown) => (x == null ? "" : String(Number(x)));

export function RequestForm({ initial, submitLabel }: { initial?: Initial; submitLabel: string }) {
  const [state, action, pending] = useActionState(saveRequest, idleState);
  const error = (key: string) => state.fields?.[key]?.[0];
  const types = new Set(initial?.propertyTypes ?? []);
  const features = new Set(initial?.features ?? []);

  const num = (name: keyof Initial, text: string, hint?: string) => (
    <div className="field">
      <label htmlFor={name}>{text}</label>
      <input id={name} name={name} className="input" inputMode="decimal" defaultValue={v(initial?.[name])} />
      {hint && <span className="hint">{hint}</span>}
      {error(name) && <span className="error">{error(name)}</span>}
    </div>
  );

  return (
    <form action={action} className="pform">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      {state.message && !state.ok && (
        <div className="notice notice--danger" role="alert">
          {state.message}
        </div>
      )}

      <section className="panel">
        <h2>Πελάτης</h2>
        <div className="formgrid">
          <div className="field">
            <label htmlFor="clientName">Ονοματεπώνυμο *</label>
            <input id="clientName" name="clientName" className="input" required defaultValue={initial?.clientName ?? ""} />
            {error("clientName") && <span className="error">{error("clientName")}</span>}
          </div>
          <div className="field">
            <label htmlFor="clientPhone">Τηλέφωνο</label>
            <input id="clientPhone" name="clientPhone" className="input" inputMode="tel" defaultValue={initial?.clientPhone ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="clientEmail">Email</label>
            <input id="clientEmail" name="clientEmail" type="email" className="input" defaultValue={initial?.clientEmail ?? ""} />
            {error("clientEmail") && <span className="error">{error("clientEmail")}</span>}
          </div>
          <div className="field">
            <label htmlFor="rating">Αξιολόγηση πελάτη</label>
            <select id="rating" name="rating" className="select" defaultValue={initial?.rating ? String(initial.rating) : ""}>
              <option value="">—</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Τι ζητά</h2>
        <div className="formgrid">
          <div className="field">
            <label htmlFor="listingType">Για</label>
            <select id="listingType" name="listingType" className="select" defaultValue={initial?.listingType ?? "SALE"}>
              {Object.keys(LISTING_TYPE_LABELS).map((key) => (
                <option key={key} value={key}>
                  {label(LISTING_TYPE_LABELS, key, "el")}
                </option>
              ))}
            </select>
          </div>
          <div className="field span2">
            <label htmlFor="areas">Περιοχές</label>
            <input id="areas" name="areas" className="input" defaultValue={(initial?.areas ?? []).join(", ")} placeholder="π.χ. Γλυφάδα, Βούλα, Βουλιαγμένη" />
            <span className="hint">Χωρίστε με κόμμα. Ταιριάζει με περιοχή, γειτονιά ή πόλη του ακινήτου.</span>
          </div>
        </div>
        <fieldset className="typepick">
          <legend>Τύποι ακινήτου (κανένας = όλοι)</legend>
          {TYPE_GROUPS.map(([group, list]) => (
            <div key={group} className="typepick__group">
              <span className="typepick__title">{group}</span>
              {list.map((key) => (
                <label key={key} className="check">
                  <input type="checkbox" name="propertyTypes" value={key} defaultChecked={types.has(key)} />
                  {label(PROPERTY_TYPE_LABELS, key, "el")}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      </section>

      <section className="panel">
        <h2>Κριτήρια</h2>
        <div className="formgrid">
          {num("minPrice", "Τιμή από (€)", "Για ενοικίαση: μηνιαίο μίσθωμα.")}
          {num("maxPrice", "Τιμή έως (€)")}
          {num("minArea", "Εμβαδόν από (m²)")}
          {num("maxArea", "Εμβαδόν έως (m²)")}
          {num("minBedrooms", "Υπνοδωμάτια τουλάχιστον")}
          {num("minBathrooms", "Μπάνια τουλάχιστον")}
          {num("minFloor", "Όροφος από", "0 = ισόγειο")}
          {num("minYearBuilt", "Κατασκευή από (έτος)")}
        </div>
        <p className="muted" style={{ margin: "6px 0 8px" }}>
          Απαραίτητες παροχές
        </p>
        <div className="checkgrid">
          {REQUEST_FEATURES.map((key) => (
            <label key={key} className="check">
              <input type="checkbox" name="features" value={key} defaultChecked={features.has(key)} />
              {fieldDef(key)?.label ?? key}
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Σημειώσεις</h2>
        <div className="formgrid">
          <div className="field span2">
            <label htmlFor="notes">Εσωτερικές σημειώσεις</label>
            <textarea id="notes" name="notes" className="textarea" defaultValue={initial?.notes ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="expiresAt">Ισχύει έως</label>
            <input id="expiresAt" name="expiresAt" type="date" className="input" defaultValue={initial?.expiresAt?.slice(0, 10) ?? ""} />
          </div>
        </div>
      </section>

      <div className="pform__footer">
        <span className="hint">Οι αντιστοιχίες με ακίνητα υπολογίζονται αυτόματα μετά την αποθήκευση.</span>
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          {pending ? "Αποθήκευση…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
