"use client";

import { useEffect, useRef, useState } from "react";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { formatMoney } from "@/lib/format";
import { CRM_BASE_PATH } from "@/lib/paths";

export type PickedProperty = {
  id: string;
  reference: string;
  titleEl: string;
  listingType: string;
  propertyType: string;
  city: string | null;
  areaName: string | null;
  neighborhood?: string | null;
  area: number | string | null;
  price: number | string | null;
};

const place = (p: PickedProperty) => [p.areaName ?? p.neighborhood, p.city].filter(Boolean).join(", ") || "-";

function Summary({ p }: { p: PickedProperty }) {
  return (
    <>
      <strong className="mono">{p.reference}</strong>
      <span>{label(PROPERTY_TYPE_LABELS, p.propertyType, "el")} · {label(LISTING_TYPE_LABELS, p.listingType, "el")}</span>
      <span>{place(p)}</span>
      <span>{p.area ? `${Number(p.area)} τ.μ.` : "-"}</span>
      <span>{p.price ? formatMoney(p.price) : "-"}</span>
    </>
  );
}

/**
 * Searchable multi-property picker. Searches by code, address, area, city or
 * title through the properties API. The chosen properties are submitted as
 * repeated hidden fields (`name`), by property code or by id.
 */
export function PropertyPicker({ name = "propertyReference", valueBy = "reference", initial = [], multiple = true, error }: { name?: string; valueBy?: "reference" | "id"; initial?: PickedProperty[]; multiple?: boolean; error?: string }) {
  const [picked, setPicked] = useState<PickedProperty[]>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedProperty[]>([]);
  const [busy, setBusy] = useState(false);
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
      setBusy(true);
      try {
        const res = await fetch(`${CRM_BASE_PATH}/api/properties?${new URLSearchParams({ q: text, limit: "8", statusGroup: "CURRENT" })}`, { credentials: "same-origin", headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: PickedProperty[] };
        if (mine === seq.current) {
          setResults(body.data);
          setFailed(false);
        }
      } catch {
        if (mine === seq.current) setFailed(true);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const add = (p: PickedProperty) => {
    setPicked((cur) => (multiple ? (cur.some((x) => x.id === p.id) ? cur : [...cur, p]) : [p]));
    setQ("");
    setResults([]);
  };

  return (
    <div className="picker">
      <label htmlFor={`${name}-search`} className="picker__label">Ακίνητα{multiple ? " (ένα ή περισσότερα)" : ""}</label>
      <input id={`${name}-search`} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Αναζήτηση με κωδικό, διεύθυνση, περιοχή ή τίτλο…" autoComplete="off" role="combobox" aria-expanded={results.length > 0} aria-controls={`${name}-results`} />
      {busy && <p className="muted small" role="status">Αναζήτηση…</p>}
      {failed && <p className="error" role="alert">Η αναζήτηση απέτυχε. Δοκιμάστε ξανά.</p>}
      {q.trim().length >= 2 && !busy && !failed && results.length === 0 && <p className="muted small">Κανένα ακίνητο δεν ταιριάζει.</p>}
      {results.length > 0 && (
        <ul id={`${name}-results`} className="picker__results" role="listbox">
          {results.map((p) => (
            <li key={p.id} role="option" aria-selected={picked.some((x) => x.id === p.id)}>
              <button type="button" className="picker__item" onClick={() => add(p)} disabled={picked.some((x) => x.id === p.id)}>
                <Summary p={p} />
                <span className="picker__title muted">{p.titleEl}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked.length > 0 ? (
        <ul className="picker__selected" aria-label="Επιλεγμένα ακίνητα">
          {picked.map((p) => (
            <li key={p.id}>
              <input type="hidden" name={name} value={valueBy === "id" ? p.id : p.reference} />
              <div className="picker__row"><Summary p={p} /></div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicked((cur) => cur.filter((x) => x.id !== p.id))} aria-label={`Αφαίρεση ${p.reference}`}>Αφαίρεση</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Δεν έχει επιλεγεί ακίνητο.</p>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
