"use client";

import { useEffect, useRef, useState } from "react";

import { personName } from "@/lib/format";
import { CRM_BASE_PATH } from "@/lib/paths";

export type PickedContact = { id: string; reference: string; firstName: string; lastName: string; company?: string | null; email?: string | null; mobile?: string | null; phone?: string | null };

/** Searchable single-contact picker; submits the contact's reference as `name`. */
export function ContactPicker({ name = "contactReference", initial = null, error }: { name?: string; initial?: PickedContact | null; error?: string }) {
  const [picked, setPicked] = useState<PickedContact | null>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedContact[]>([]);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${CRM_BASE_PATH}/api/contacts?${new URLSearchParams({ q: text, limit: "8" })}`, { credentials: "same-origin", headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: PickedContact[] };
        if (mine === seq.current) {
          setResults(body.data);
          setFailed(false);
        }
      } catch {
        if (mine === seq.current) setFailed(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="picker">
      <label htmlFor={`${name}-search`} className="picker__label">Πελάτης</label>
      {picked ? (
        <ul className="picker__selected">
          <li>
            <input type="hidden" name={name} value={picked.reference} />
            <div className="picker__row"><strong>{personName(picked.firstName, picked.lastName)}</strong><span className="mono muted">{picked.reference}</span><span>{picked.mobile ?? picked.phone ?? picked.email ?? ""}</span></div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicked(null)}>Αλλαγή</button>
          </li>
        </ul>
      ) : (
        <>
          <input id={`${name}-search`} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Όνομα, κωδικός, email ή τηλέφωνο…" autoComplete="off" />
          {failed && <p className="error" role="alert">Η αναζήτηση απέτυχε.</p>}
          {results.length > 0 && (
            <ul className="picker__results" role="listbox">
              {results.map((c) => (
                <li key={c.id} role="option" aria-selected={false}>
                  <button type="button" className="picker__item" onClick={() => { setPicked(c); setQ(""); setResults([]); }}>
                    <strong>{personName(c.firstName, c.lastName)}</strong><span className="mono muted">{c.reference}</span><span>{c.mobile ?? c.phone ?? "-"}</span><span>{c.email ?? "-"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && !failed && <p className="muted small">Καμία επαφή δεν ταιριάζει.</p>}
        </>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
