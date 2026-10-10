"use client";

import type { IntakeSession } from "@/lib/intake-client";

import { Icon, type IconName } from "../Icon";
import type { StepIndex } from "./steps";

type RowState = "ok" | "review" | "missing";
export type KeyRow = { key: string; label: string; icon: IconName; state: RowState; display: string | null; step: StepIndex };

const TEXT_KEYS = ["titleEl", "titleEn", "descriptionEl", "descriptionEn"];

/**
 * The five facts every listing needs, as they stand on the server right now. A value counts as captured only
 * once it is the agent's own or approved; a suggestion (a written title, an unconfirmed value) is shown as
 * "to review", never as done.
 */
export function keyRows(session: IntakeSession | null): KeyRow[] {
  const rent = session?.fields.listingType?.value === "RENT";
  const row = (key: string, label: string, icon: IconName, step: StepIndex): KeyRow => {
    const f = session?.fields[key];
    const display = session?.review.rows.find((r) => r.key === key)?.display ?? (f ? String(f.value) : null);
    return { key, label, icon, step, display: f ? display : null, state: !f ? "missing" : f.confirmed ? "ok" : "review" };
  };
  const price = row(rent ? "monthlyRent" : "price", rent ? "Μηνιαίο μίσθωμα" : "Τιμή πώλησης", "euro", 1);
  const onRequest = session?.fields.priceOnRequest;
  if (price.state === "missing" && onRequest?.value === true) Object.assign(price, { state: onRequest.confirmed ? "ok" : "review", display: "Κατόπιν επικοινωνίας" });
  const place = row("areaName", "Περιοχή", "pin", 1);
  if (place.state === "missing" && session?.fields.city) Object.assign(place, row("city", "Περιοχή", "pin", 1), { key: "areaName" });
  return [row("titleEl", "Τίτλος", "heading", 4), row("descriptionEl", "Περιγραφή", "lines", 4), price, place, row("area", "Εμβαδόν", "ruler", 1)];
}

/** Prompts that help the agent say what is still missing; tapping one starts the sentence in the text box. */
const SHORTCUTS: Array<{ needs: string[]; text: string; label: string; icon: IconName }> = [
  { needs: ["propertyType", "areaName"], label: "Τύπος ακινήτου και περιοχή", text: "Τύπος ακινήτου και περιοχή: ", icon: "building" },
  { needs: ["price"], label: "Τιμή πώλησης ή μίσθωμα", text: "Τιμή: ", icon: "euro" },
  { needs: ["area"], label: "Εμβαδόν", text: "Εμβαδόν: ", icon: "ruler" },
  { needs: ["floor", "bedrooms"], label: "Όροφος και υπνοδωμάτια", text: "Όροφος και υπνοδωμάτια: ", icon: "home" },
];

const STATE_TEXT: Record<RowState, string> = { ok: "Καταγράφηκε", review: "Χρειάζεται έλεγχο", missing: "Λείπει" };

export function CapturePanel({ session, onGo, onShortcut, disabled }: { session: IntakeSession | null; onGo: (step: StepIndex, key: string) => void; onShortcut: (text: string) => void; disabled?: boolean }) {
  const rows = keyRows(session);
  const ok = rows.filter((r) => r.state === "ok").length;
  const toReview = rows.filter((r) => r.state === "review").length;
  const empty = !session || Object.keys(session.fields).length === 0;
  const others = session ? session.review.rows.filter((r) => !TEXT_KEYS.includes(r.key) && !["price", "monthlyRent", "areaName", "area", "priceOnRequest"].includes(r.key)) : [];
  const proposals = session ? TEXT_KEYS.filter((k) => session.fields[k] && !session.fields[k]!.confirmed).length : 0;
  const shortcuts = SHORTCUTS.filter((s) => s.needs.some((k) => !session?.fields[k]));

  return (
    <aside className="xcard xcapture" aria-labelledby="capture-title">
      <header className="xcapture__head">
        <span className="xicon-tile xicon-tile--sm" aria-hidden="true"><Icon name="wave" size={20} /></span>
        <h2 id="capture-title">Τι έχει καταγραφεί</h2>
        <span className="xcount" aria-label={`${ok} από 5 βασικά στοιχεία καταγράφηκαν`}>{ok} / 5 στοιχεία</span>
      </header>
      <div className="xprogress" role="progressbar" aria-label="Βασικά στοιχεία" aria-valuemin={0} aria-valuemax={5} aria-valuenow={ok}>
        <span style={{ width: `${(ok / 5) * 100}%` }} />
      </div>

      {empty ? (
        <div className="xcapture__empty">
          <span className="xcapture__bubble" aria-hidden="true"><Icon name="chat" size={26} /></span>
          <p className="xcapture__empty-title">Δεν έχουν καταγραφεί ακόμη πληροφορίες</p>
          <p>Ό,τι πείτε ή πληκτρολογήσετε θα εμφανίζεται εδώ σε πραγματικό χρόνο.</p>
        </div>
      ) : (
        <ul className="xfacts">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" className={`xfact xfact--${r.state}`} onClick={() => onGo(r.step, r.key)} title={r.state === "ok" ? "Αλλαγή" : r.state === "review" ? "Έλεγχος" : "Συμπλήρωση"}>
                <span className="xfact__icon" aria-hidden="true"><Icon name={r.icon} size={18} /></span>
                <span className="xfact__main">
                  <span className="xfact__label">{r.label}</span>
                  <span className="xfact__value">{r.display ?? "—"}</span>
                </span>
                <span className="xfact__state">
                  {r.state === "ok" ? <Icon name="check" size={15} /> : r.state === "review" ? <Icon name="alert" size={15} /> : null}
                  {STATE_TEXT[r.state]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <div className="xcapture__more">
          <h3>Επίσης καταγράφηκαν</h3>
          <ul>
            {others.map((r) => (
              <li key={r.key} className={r.needsConfirmation ? "is-review" : undefined}>
                <span>{r.label}</span> <strong>{r.display}</strong>
                {r.needsConfirmation && <span className="sr-only"> (χρειάζεται επιβεβαίωση)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {shortcuts.length > 0 && (
        <div className="xcapture__shortcuts">
          <h3>Συντομεύσεις</h3>
          <p className="hint">Πατήστε για να ξεκινήσει η πρόταση στο κείμενο· τη συμπληρώνετε εσείς.</p>
          <ul>
            {shortcuts.map((s) => (
              <li key={s.label}>
                <button type="button" className="xshortcut" disabled={disabled} onClick={() => onShortcut(s.text)}>
                  <Icon name={s.icon} size={17} />
                  <span>{s.label}</span>
                  <Icon name="arrowRight" size={14} className="xshortcut__go" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="xinfo">
        <Icon name="info" size={18} />
        <span>
          {proposals > 0
            ? `${proposals} ${proposals === 1 ? "πρόταση κειμένου περιμένει" : "προτάσεις κειμένου περιμένουν"} την έγκρισή σας στο βήμα «Έλεγχος & αποθήκευση». Δεν αποθηκεύονται χωρίς έγκριση.`
            : "Ο τίτλος και η περιγραφή γράφονται αυτόματα μόλις υπάρχουν αρκετά στοιχεία, ως προτάσεις που εγκρίνετε εσείς."}
          {toReview > 0 && ` ${toReview === 1 ? "Ένα στοιχείο χρειάζεται" : `${toReview} στοιχεία χρειάζονται`} έλεγχο.`}
        </span>
      </p>
    </aside>
  );
}
