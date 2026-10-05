"use client";

import { useState } from "react";

import { newIdempotencyKey, readAttribution } from "@/lib/intake-client";
import { PhotoUploader, type UploaderValue } from "@/components/PhotoUploader";

/**
 * Generic public capture form.
 *
 * All four public forms (contact, submit-a-property, request-a-property, DMCA
 * notice) share the same machinery on purpose: honeypot, time trap, server-side
 * age gate and an unchecked consent box. Implementing them once means a new
 * form cannot accidentally ship without the age gate — the field set is passed
 * in, the compliance fields are not optional.
 */

export type CaptureField = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "textarea" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  rows?: number;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  /** Fields the user never fills; sent verbatim. */
  hidden?: boolean;
  defaultValue?: string;
};

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; reference: string | null }
  | { kind: "error"; message: string; fields?: Record<string, string[]> };

export function CaptureForm({
  endpoint,
  fields,
  extra,
  submitLabel,
  successMessage,
  includeAgeGate = true,
  consentLabel,
  policyHref = "/privacy",
  uploads = false,
}: {
  endpoint: string;
  fields: CaptureField[];
  /** Non-field values merged into the payload, e.g. { listingType: "SALE" }. */
  extra?: Record<string, string>;
  submitLabel: string;
  successMessage: string;
  includeAgeGate?: boolean;
  consentLabel?: string;
  policyHref?: string;
  /** Show the private photo/document uploader (owner submissions). */
  uploads?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [renderedAt] = useState(() => Date.now());
  // One key per form instance, kept across retries: a resubmit is the same submission.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [uploaded, setUploaded] = useState<UploaderValue>({ token: null, files: [], busy: false });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploads && uploaded.busy) {
      setState({ kind: "error", message: "Περιμένετε να ολοκληρωθεί η μεταφόρτωση των αρχείων." });
      return;
    }
    setState({ kind: "submitting" });

    const form = new FormData(e.currentTarget);

    const payload: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      if (f.hidden) {
        payload[f.name] = f.defaultValue ?? "";
        continue;
      }
      const v = form.get(f.name);
      if (f.type === "checkbox") {
        payload[f.name] = v === "on";
      } else if (f.type === "number") {
        payload[f.name] = v ? Number(v) : undefined;
      } else {
        payload[f.name] = String(v ?? "");
      }
    }

    if (includeAgeGate) {
      payload.dateOfBirth = String(form.get("dateOfBirth") ?? "");
      payload.ageAffirmation = form.get("ageAffirmation") === "on";
    }

    payload.consent = {
      necessary: true,
      analytics: form.get("consentAnalytics") === "on",
      marketing: form.get("consentMarketing") === "on",
    };
    payload.hpl = String(form.get("hpl") ?? "");
    payload.hpt = String(renderedAt);
    payload.idempotencyKey = idempotencyKey;
    payload.attribution = readAttribution();
    if (uploads && uploaded.token && uploaded.files.length > 0) {
      payload.uploads = { token: uploaded.token, files: uploaded.files };
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState({
          kind: "error",
          message:
            typeof body?.message === "string"
              ? body.message
              : "Η υποβολή δεν ήταν δυνατή. Δοκιμάστε ξανά.",
          fields: body?.fields,
        });
        return;
      }
      setState({ kind: "ok", reference: body?.reference ?? null });
    } catch {
      setState({ kind: "error", message: "Πρόβλημα σύνδεσης. Δοκιμάστε ξανά." });
    }
  }

  if (state.kind === "ok") {
    return (
      <div className="notice" role="status">
        <strong>Ευχαριστούμε.</strong>
        <p style={{ margin: "6px 0 0" }}>
          {successMessage}
          {state.reference ? (
            <>
              {" "}
              Ο κωδικός σας είναι <strong>{state.reference}</strong>.
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const disabled = state.kind === "submitting" || (uploads && uploaded.busy);

  return (
    <form onSubmit={onSubmit} noValidate>
      {state.kind === "error" && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 14 }}>
          {state.message}
        </div>
      )}

      {fields
        .filter((f) => !f.hidden)
        .map((f) => {
          const id = `cf-${endpoint.replace(/\W+/g, "-")}-${f.name}`;
          const err = state.kind === "error" ? state.fields?.[f.name]?.[0] : undefined;

          return (
            <div className="field" key={f.name}>
              {f.type !== "checkbox" && (
                <label htmlFor={id}>
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
              )}

              {f.type === "checkbox" ? (
                <label className="check" htmlFor={id}>
                  <input id={id} name={f.name} type="checkbox" required={f.required} />
                  <span>
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                </label>
              ) : f.type === "textarea" ? (
                <textarea
                  id={id}
                  name={f.name}
                  className="textarea"
                  rows={f.rows ?? 4}
                  required={f.required}
                  placeholder={f.placeholder}
                  defaultValue={f.defaultValue}
                />
              ) : f.type === "select" ? (
                <select
                  id={id}
                  name={f.name}
                  className="select"
                  required={f.required}
                  defaultValue={f.defaultValue ?? ""}
                >
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  name={f.name}
                  type={f.type ?? "text"}
                  className="input"
                  required={f.required}
                  autoComplete={f.autoComplete}
                  placeholder={f.placeholder}
                  defaultValue={f.defaultValue}
                />
              )}

              {f.hint && <span className="hint">{f.hint}</span>}
              {err && <span className="error">{err}</span>}
            </div>
          );
        })}

      {uploads && <PhotoUploader onChange={setUploaded} />}

      {includeAgeGate && (
        <>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />

          <div className="field">
            <label htmlFor="cf-dob">Ημερομηνία γέννησης</label>
            <input
              id="cf-dob"
              name="dateOfBirth"
              type="date"
              className="input"
              autoComplete="bday"
              required
              aria-describedby={state.kind === "error" && state.fields?.dateOfBirth ? "cf-dob-hint cf-dob-error" : "cf-dob-hint"}
              aria-invalid={state.kind === "error" && state.fields?.dateOfBirth ? true : undefined}
            />
            <span className="hint" id="cf-dob-hint">
              Απαιτείται μόνο για επιβεβαίωση ότι είστε 18 ετών ή μεγαλύτερος/η. Δεν αποθηκεύεται —
              κρατάμε μόνο το αποτέλεσμα του ελέγχου.
            </span>
          </div>

          <label className="check">
            <input type="checkbox" name="ageAffirmation" required />
            <span>Είμαι 18 ετών ή μεγαλύτερος/η.</span>
          </label>

          {state.kind === "error" && state.fields?.dateOfBirth && (
            <span id="cf-dob-error" role="alert" className="error" style={{ display: "block", marginBottom: 10 }}>
              {state.fields.dateOfBirth[0]}
            </span>
          )}

          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
        </>
      )}

      <label className="check">
        <input type="checkbox" checked disabled readOnly />
        <span>
          {consentLabel ?? "Επεξεργασία των στοιχείων μου για να απαντηθεί το αίτημα."}{" "}
          <em className="muted">(απαραίτητο)</em>
        </span>
      </label>

      <label className="check">
        <input type="checkbox" name="consentAnalytics" />
        <span>
          Ανώνυμα στατιστικά χρήσης. <em className="muted">(προαιρετικό)</em>
        </span>
      </label>

      <label className="check">
        <input type="checkbox" name="consentMarketing" />
        <span>
          Ενημέρωση για νέα ακίνητα και προσφορές.{" "}
          <em className="muted">(προαιρετικό — διαγραφή οποτεδήποτε)</em>
        </span>
      </label>

      <div className="hp-field" aria-hidden="true">
        <label htmlFor="cf-hpl">Website</label>
        <input id="cf-hpl" name="hpl" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" className="btn btn--primary btn--block" disabled={disabled} style={{ marginTop: 8 }}>
        {disabled ? "Αποστολή…" : submitLabel}
      </button>

      <p className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
        Υποβάλλοντας αποδέχεστε την <a href={policyHref}>πολιτική απορρήτου</a>.
      </p>
    </form>
  );
}
