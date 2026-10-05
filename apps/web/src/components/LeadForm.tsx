"use client";

import { useState } from "react";

import { newIdempotencyKey, readAttribution } from "@/lib/intake-client";

/**
 * Property enquiry form.
 *
 * Client-side validation here is for feedback speed only. The same rules are
 * enforced again in /api/leads, because anything in this file can be bypassed
 * by posting the endpoint directly.
 */

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; reference: string | null }
  | { kind: "error"; message: string; fields?: Record<string, string[]> };

export function LeadForm({
  propertyReference,
  kind,
  valuationRequestId,
}: {
  propertyReference?: string;
  kind?: "valuation";
  /** Links the request to the indicative valuation the visitor just ran (server reads the details). */
  valuationRequestId?: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  // Time trap: rendered once when the form mounts. The server rejects a
  // submission completed faster than a human could plausibly type.
  const [renderedAt] = useState(() => Date.now());
  // One key per form instance, kept across retries so a resubmit is the same submission.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [wantsViewing, setWantsViewing] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });

    const form = new FormData(e.currentTarget);
    const payload = {
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      message: String(form.get("message") ?? ""),
      preferredContactMethod: String(form.get("preferredContactMethod") ?? "ANY"),
      propertyReference: propertyReference ?? "",
      dateOfBirth: String(form.get("dateOfBirth") ?? ""),
      ageAffirmation: form.get("ageAffirmation") === "on",
      consent: {
        necessary: true,
        analytics: form.get("consentAnalytics") === "on",
        marketing: form.get("consentMarketing") === "on",
      },
      hpl: String(form.get("hpl") ?? ""),
      hpt: String(renderedAt),
      idempotencyKey,
      attribution: readAttribution(),
      ...(valuationRequestId ? { valuationRequestId } : {}),
    };

    // A viewing request is its own flow: it stays a request until an agent confirms.
    const preferred = String(form.get("preferredStart") ?? "");
    const viewing = Boolean(propertyReference) && form.get("requestViewing") === "on";
    const endpoint = viewing ? "/api/viewings" : kind === "valuation" ? "/api/valuation" : "/api/leads";
    if (viewing && preferred) (payload as Record<string, unknown>).preferredStart = new Date(preferred).toISOString();
    if (kind === "valuation" && !payload.message.trim()) payload.message = "Αίτημα εκτίμησης";

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
          Λάβαμε το αίτημά σας
          {state.reference ? <> με κωδικό <strong>{state.reference}</strong></> : null}.
          Θα επικοινωνήσουμε μαζί σας σύντομα.
        </p>
      </div>
    );
  }

  const disabled = state.kind === "submitting";

  return (
    <form onSubmit={onSubmit} noValidate>
      {state.kind === "error" && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 14 }}>
          {state.message}
        </div>
      )}

      <div className="grid grid--2" style={{ gap: 0 }}>
        <div className="field">
          <label htmlFor="lead-firstName">Όνομα *</label>
          <input id="lead-firstName" name="firstName" className="input" required autoComplete="given-name" />
          {state.kind === "error" && state.fields?.firstName && (
            <span className="error">{state.fields.firstName[0]}</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="lead-lastName">Επώνυμο</label>
          <input id="lead-lastName" name="lastName" className="input" autoComplete="family-name" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="lead-email">Email</label>
        <input id="lead-email" name="email" type="email" className="input" autoComplete="email" />
        {state.kind === "error" && state.fields?.email && (
          <span className="error">{state.fields.email[0]}</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="lead-phone">Τηλέφωνο</label>
        <input id="lead-phone" name="phone" type="tel" className="input" autoComplete="tel" />
        {state.kind === "error" && state.fields?.phone && (
          <span className="error">{state.fields.phone[0]}</span>
        )}
      </div>

      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
        Συμπληρώστε τουλάχιστον ένα από τα δύο.
      </p>

      <div className="field">
        <label htmlFor="lead-message">Μήνυμα</label>
        <textarea id="lead-message" name="message" className="textarea" rows={4} />
      </div>

      {propertyReference && (
        <>
          <label className="check">
            <input type="checkbox" name="requestViewing" checked={wantsViewing} onChange={(e) => setWantsViewing(e.target.checked)} />
            <span>Θέλω να κλείσω επίσκεψη</span>
          </label>
          {wantsViewing && (
            <div className="field">
              <label htmlFor="lead-when">Προτιμώμενη ημερομηνία και ώρα</label>
              <input id="lead-when" name="preferredStart" type="datetime-local" className="input" />
              <span className="hint">Είναι αίτημα· ο σύμβουλος θα επιβεβαιώσει το ραντεβού μαζί σας.</span>
            </div>
          )}
        </>
      )}

      <div className="field">
        <label htmlFor="lead-pref">Προτιμώμενη επικοινωνία</label>
        <select id="lead-pref" name="preferredContactMethod" className="select" defaultValue="ANY">
          <option value="ANY">Οτιδήποτε</option>
          <option value="PHONE">Τηλέφωνο</option>
          <option value="EMAIL">Email</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="SMS">SMS</option>
        </select>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />

      {/*
        Age gate (18+). Both the date of birth and the affirmation are
        required, and the server re-checks them independently of this form.
      */}
      <div className="field">
        <label htmlFor="lead-dob">Ημερομηνία γέννησης</label>
        <input
          id="lead-dob"
          name="dateOfBirth"
          type="date"
          className="input"
          autoComplete="bday"
          required
          aria-describedby={state.kind === "error" && state.fields?.dateOfBirth ? "lead-dob-hint lead-dob-error" : "lead-dob-hint"}
          aria-invalid={state.kind === "error" && state.fields?.dateOfBirth ? true : undefined}
        />
        <span className="hint" id="lead-dob-hint">
          Απαιτείται μόνο για επιβεβαίωση ότι είστε 18 ετών ή μεγαλύτερος/η. Δεν αποθηκεύεται —
          κρατάμε μόνο το αποτέλεσμα του ελέγχου.
        </span>
      </div>

      <label className="check">
        <input type="checkbox" name="ageAffirmation" required />
        <span>Είμαι 18 ετών ή μεγαλύτερος/η.</span>
      </label>

      {state.kind === "error" && state.fields?.dateOfBirth && (
        <span id="lead-dob-error" role="alert" className="error" style={{ display: "block", marginBottom: 10 }}>
          {state.fields.dateOfBirth[0]}
        </span>
      )}

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />

      {/*
        Consent. Unchecked by default, and the marketing box is separate from
        the enquiry itself — agreeing to be answered is not agreeing to be
        marketed to.
      */}
      <label className="check">
        <input type="checkbox" name="consentNecessaryDisabled" checked disabled readOnly />
        <span>
          Επεξεργασία των στοιχείων μου για να απαντηθεί το αίτημα.{" "}
          <em className="muted">(απαραίτητο)</em>
        </span>
      </label>

      <label className="check">
        <input type="checkbox" name="consentAnalytics" />
        <span>Ανώνυμα στατιστικά χρήσης. <em className="muted">(προαιρετικό)</em></span>
      </label>

      <label className="check">
        <input type="checkbox" name="consentMarketing" />
        <span>
          Ενημέρωση για νέα ακίνητα και προσφορές. <em className="muted">(προαιρετικό — μπορείτε να
          διαγραφείτε οποτεδήποτε)</em>
        </span>
      </label>

      {/* Honeypot: off-screen, never focusable, not announced to screen readers. */}
      <div className="hp-field" aria-hidden="true">
        <label htmlFor="lead-hpl">Website</label>
        <input id="lead-hpl" name="hpl" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" className="btn btn--primary btn--block" disabled={disabled} style={{ marginTop: 8 }}>
        {disabled ? "Αποστολή…" : propertyReference ? (wantsViewing ? "Αίτημα επίσκεψης" : "Ενδιαφέρομαι") : "Αποστολή αιτήματος"}
      </button>

      <p className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
        Υποβάλλοντας αποδέχεστε την{" "}
        <a href="/privacy">πολιτική απορρήτου</a>.
      </p>
    </form>
  );
}
