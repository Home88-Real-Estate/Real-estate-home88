"use client";

/**
 * Property editor. Which fields appear, their labels, units, options and what
 * is required all come from the shared property profiles in @home88/domain,
 * the same definition the API validates against.
 *
 * Values live in one state object, so switching property type keeps what was
 * typed: switching back restores it. Fields that do not apply to the chosen
 * type are not sent; the form says which ones before saving.
 */

import { useActionState, useState } from "react";
import {
  CONDITION_LABELS,
  CORE_FIELDS,
  CORE_FLAGS,
  DETAIL_FIELDS,
  completeness,
  fieldDef,
  listingProfileFor,
  profileFor,
  type FieldDef,
} from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { idleState, type ActionState } from "@/lib/form";

type Initial = Record<string, unknown>;
type Values = Record<string, string | boolean>;

const TYPE_GROUPS: Array<[string, string[]]> = [
  ["Κατοικία", ["APARTMENT", "STUDIO", "MAISONETTE", "HOUSE", "VILLA"]],
  ["Επαγγελματικό", ["OFFICE", "SHOP", "WAREHOUSE", "BUILDING", "HOTEL", "INDUSTRIAL"]],
  ["Γη", ["LAND", "PLOT"]],
  ["Λοιπά", ["PARKING", "OTHER"]],
];

const LOCATION_FIELDS: Array<[string, string, boolean?]> = [
  ["region", "Περιφέρεια"],
  ["city", "Πόλη / Δήμος"],
  ["areaName", "Περιοχή"],
  ["neighborhood", "Γειτονιά"],
  ["address", "Διεύθυνση", true],
  ["postalCode", "Τ.Κ."],
  ["latitude", "Γεωγρ. πλάτος"],
  ["longitude", "Γεωγρ. μήκος"],
];

function initialValues(initial: Initial | undefined): Values {
  const values: Values = {
    listingType: "SALE",
    propertyType: "APARTMENT",
    status: "DRAFT",
    condition: "GOOD",
    heating: "NOT_AVAILABLE",
    energyClass: "NOT_AVAILABLE",
  };
  if (!initial) return values;
  for (const [key, value] of Object.entries(initial)) {
    if (key === "details" || value == null || typeof value === "object") continue;
    values[key] = typeof value === "boolean" ? value : String(value);
  }
  const details = initial.details;
  if (details && typeof details === "object") {
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      if (value == null) continue;
      values[`details.${key}`] = typeof value === "boolean" ? value : String(value);
    }
  }
  return values;
}

/** The form's values in the shape the profiles understand. */
function asRecord(values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("details.")) details[key.slice(8)] = value;
    else out[key] = value;
  }
  out.details = details;
  return out;
}

function nameOf(key: string): string {
  return key in DETAIL_FIELDS && !(key in CORE_FIELDS) && !(key in CORE_FLAGS) ? `details.${key}` : key;
}

function isSet(value: string | boolean | undefined): boolean {
  return value !== undefined && value !== "" && value !== false && value !== "NOT_AVAILABLE";
}

const ALL_KEYS = [...Object.keys(CORE_FIELDS), ...Object.keys(CORE_FLAGS), ...Object.keys(DETAIL_FIELDS), "price", "monthlyRent"];

const euro = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function PropertyForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Initial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const [values, setValues] = useState<Values>(() => initialValues(initial));
  const id = typeof initial?.id === "string" ? initial.id : "";

  const type = String(values.propertyType);
  const listing = String(values.listingType);
  const profile = profileFor(type);
  const pricing = listingProfileFor(listing);
  const draft = values.status === "DRAFT";

  const set = (key: string, value: string | boolean) => setValues((v) => ({ ...v, [key]: value }));
  const error = (key: string) => state.fields?.[key]?.[0];
  const labelOf = (key: string) => profile.labels?.[key] ?? fieldDef(key)?.label ?? key;
  const required = new Set(profile.required);

  // Detail fields of the type that the pricing section does not already show.
  const typeDetails = profile.details.filter((key) => !pricing.details.includes(key));
  const visible = new Set<string>([...profile.core, ...typeDetails, ...profile.features, ...pricing.details, pricing.priceField]);

  // Values typed for fields that do not apply now (kept in the form, not saved).
  const hiddenWithValues = ALL_KEYS.filter((key) => !visible.has(key) && isSet(values[nameOf(key)])).map(
    (key) => fieldDef(key)?.label ?? (key === "price" ? "Τιμή" : key === "monthlyRent" ? "Μίσθωμα" : key),
  );

  const score = completeness(asRecord(values));
  const priceValue = Number(String(values[pricing.priceField] ?? "").replace(",", "."));
  const areaValue = Number(String(values.area ?? "").replace(",", "."));
  const perSqm =
    pricing.priceField === "price" && priceValue > 0 && areaValue > 0 ? euro.format(priceValue / areaValue) : null;

  const field = (key: string, span2 = false) => {
    const def = fieldDef(key);
    if (!def) return null;
    const name = nameOf(key);
    return (
      <Field
        key={key}
        def={def}
        name={name}
        label={labelOf(key)}
        required={required.has(key)}
        value={values[name]}
        onChange={(v) => set(name, v)}
        error={error(name)}
        span2={span2}
      />
    );
  };

  return (
    <form action={formAction} className="pform">
      {id && <input type="hidden" name="id" value={id} />}

      {state.message && (
        <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role="alert">
          {state.message}
        </div>
      )}

      <section className="panel">
        <h2>Βασικά στοιχεία</h2>
        <div className="formgrid">
          <TextInput name="titleEl" label="Τίτλος (ελληνικά)" required value={values.titleEl} onChange={set} error={error("titleEl")} span2 />
          <TextInput name="titleEn" label="Τίτλος (αγγλικά)" value={values.titleEn} onChange={set} error={error("titleEn")} span2 />
          <div className="field">
            <label htmlFor="listingType">Είδος αγγελίας</label>
            <select id="listingType" name="listingType" className="select" value={listing} onChange={(e) => set("listingType", e.target.value)}>
              {Object.keys(LISTING_TYPE_LABELS).map((key) => (
                <option key={key} value={key}>
                  {label(LISTING_TYPE_LABELS, key, "el")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="propertyType">Τύπος ακινήτου</label>
            <select id="propertyType" name="propertyType" className="select" value={type} onChange={(e) => set("propertyType", e.target.value)}>
              {TYPE_GROUPS.map(([group, types]) => (
                <optgroup key={group} label={group}>
                  {types.map((key) => (
                    <option key={key} value={key}>
                      {label(PROPERTY_TYPE_LABELS, key, "el")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {!id && (
            <div className="field">
              <label htmlFor="status">Κατάσταση καταχώρισης</label>
              <select id="status" name="status" className="select" value={String(values.status)} onChange={(e) => set("status", e.target.value)}>
                {["DRAFT", "ACTIVE"].map((key) => (
                  <option key={key} value={key}>
                    {label(PROPERTY_STATUS_LABELS, key, "el")}
                  </option>
                ))}
              </select>
              <span className="hint">Ένα πρόχειρο αποθηκεύεται και ελλιπές.</span>
            </div>
          )}
          {profile.conditions && (
            <div className="field">
              <label htmlFor="condition">Κατάσταση ακινήτου</label>
              <select id="condition" name="condition" className="select" value={String(values.condition)} onChange={(e) => set("condition", e.target.value)}>
                {profile.conditions.map((key) => (
                  <option key={key} value={key}>
                    {CONDITION_LABELS[key]}
                  </option>
                ))}
              </select>
              {error("condition") && <span className="error">{error("condition")}</span>}
            </div>
          )}
          <TextInput
            name="reference"
            label="Κωδικός ακινήτου"
            value={values.reference}
            onChange={set}
            hint="Αφήστε το κενό για αυτόματο κωδικό (H88-000001)."
            error={error("reference")}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Τιμή και όροι</h2>
        <div className="formgrid">
          <TextInput
            name={pricing.priceField}
            label={`${pricing.priceLabel} (€)`}
            required={!values.priceOnRequest}
            value={values[pricing.priceField]}
            onChange={set}
            error={error(pricing.priceField)}
            inputMode="decimal"
            hint={perSqm ? `${perSqm} ανά m²` : undefined}
          />
          {pricing.details.map((key) => field(key))}
          <TextInput name="commissionRatePct" label="Αμοιβή γραφείου (%)" value={values.commissionRatePct} onChange={set} error={error("commissionRatePct")} inputMode="decimal" hint="Εσωτερικό στοιχείο." />
          <TextInput name="agentCommissionPct" label="Ποσοστό συνεργάτη (%)" value={values.agentCommissionPct} onChange={set} error={error("agentCommissionPct")} inputMode="decimal" hint="Εσωτερικό στοιχείο." />
        </div>
        <Check name="priceOnRequest" label="Τιμή κατόπιν επικοινωνίας" value={values.priceOnRequest} onChange={set} />
      </section>

      <section className="panel">
        <h2>{profile.title}</h2>
        <div className="formgrid">
          {profile.core.map((key) => field(key))}
          {typeDetails.map((key) => field(key, DETAIL_FIELDS[key]?.kind === "text"))}
        </div>
      </section>

      {profile.features.length > 0 && (
        <section className="panel">
          <h2>{type === "LAND" || type === "PLOT" ? "Παροχές και υποδομές" : "Παροχές"}</h2>
          <div className="checkgrid">
            {profile.features.map((key) => (
              <Check key={key} name={nameOf(key)} label={labelOf(key)} value={values[nameOf(key)]} onChange={set} />
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Τοποθεσία</h2>
        <div className="formgrid">
          {LOCATION_FIELDS.map(([key, text, span2]) => (
            <TextInput key={key} name={key} label={text} value={values[key]} onChange={set} error={error(key)} span2={span2} />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Περιγραφή</h2>
        <div className="field">
          <label htmlFor="descriptionEl">Περιγραφή (ελληνικά) *</label>
          <textarea id="descriptionEl" name="descriptionEl" className="textarea" required value={String(values.descriptionEl ?? "")} onChange={(e) => set("descriptionEl", e.target.value)} />
          {error("descriptionEl") && <span className="error">{error("descriptionEl")}</span>}
        </div>
        <div className="field">
          <label htmlFor="descriptionEn">Περιγραφή (αγγλικά)</label>
          <textarea id="descriptionEn" name="descriptionEn" className="textarea" value={String(values.descriptionEn ?? "")} onChange={(e) => set("descriptionEn", e.target.value)} />
          {error("descriptionEn") && <span className="error">{error("descriptionEn")}</span>}
        </div>
      </section>

      <section className="panel">
        <h2>Πολυμέσα και δημοσίευση</h2>
        <div className="formgrid">
          <TextInput name="videoUrl" label="Σύνδεσμος βίντεο" value={values.videoUrl} onChange={set} error={error("videoUrl")} />
          <TextInput name="virtualTourUrl" label="Σύνδεσμος εικονικής περιήγησης" value={values.virtualTourUrl} onChange={set} error={error("virtualTourUrl")} />
        </div>
        <Check name="publishedOnWebsite" label="Δημοσίευση στον ιστότοπο" value={values.publishedOnWebsite} onChange={set} />
        <Check name="featured" label="Προβεβλημένο" value={values.featured} onChange={set} />
      </section>

      {hiddenWithValues.length > 0 && (
        <div className="notice notice--warn" role="status">
          Ορισμένα στοιχεία δεν ισχύουν για «{label(PROPERTY_TYPE_LABELS, type, "el")}» και δεν θα αποθηκευτούν:{" "}
          {hiddenWithValues.join(", ")}. Αν επιστρέψετε στον προηγούμενο τύπο πριν την αποθήκευση, οι τιμές
          επανέρχονται.
        </div>
      )}

      <div className="pform__footer">
        <div className="pform__score" aria-live="polite">
          <strong>Πληρότητα {score.percent}%</strong>
          <span className="pform__bar" aria-hidden="true">
            <span style={{ width: `${score.percent}%` }} />
          </span>
          {score.missing.length > 0 && <span className="hint">Λείπουν: {score.missing.join(", ")}</span>}
          {!draft && <span className="hint">Τα πεδία με * είναι υποχρεωτικά για ενεργό ακίνητο.</span>}
        </div>
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          {pending ? "Αποθήκευση…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  def,
  name,
  label,
  required,
  value,
  onChange,
  error,
  span2,
}: {
  def: FieldDef;
  name: string;
  label: string;
  required?: boolean;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
  error?: string;
  span2?: boolean;
}) {
  if (def.kind === "bool") return <Check name={name} label={label} value={value} onChange={(_, v) => onChange(v)} />;
  const text = `${label}${def.unit ? ` (${def.unit})` : ""}`;
  return (
    <div className={`field${span2 ? " span2" : ""}`}>
      <label htmlFor={name}>
        {text}
        {required ? " *" : ""}
      </label>
      {def.kind === "select" ? (
        <select id={name} name={name} className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {!def.options?.some(([v]) => v === "NOT_AVAILABLE") && <option value="">—</option>}
          {def.options?.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          className="input"
          type={def.kind === "date" ? "date" : "text"}
          inputMode={def.kind === "int" ? "numeric" : def.kind === "decimal" ? "decimal" : undefined}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {def.hint && <span className="hint">{def.hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function TextInput({
  name,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  span2,
  inputMode,
}: {
  name: string;
  label: string;
  value: string | boolean | undefined;
  onChange: (key: string, value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  span2?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <div className={`field${span2 ? " span2" : ""}`}>
      <label htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        className="input"
        inputMode={inputMode}
        value={String(value ?? "")}
        onChange={(e) => onChange(name, e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function Check({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string | boolean | undefined;
  onChange: (key: string, value: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" name={name} checked={value === true || value === "true"} onChange={(e) => onChange(name, e.target.checked)} />
      {label}
    </label>
  );
}
