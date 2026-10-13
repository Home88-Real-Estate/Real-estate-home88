"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { CRM_BASE_PATH } from "@/lib/paths";

import { Icon } from "../../Icon";
import { GLOBAL_SEARCH_ID } from "./FocusSearchButton";

type Result = { type: string; id: string; title: string; subtitle: string | null; href: string };

const TYPE_LABEL: Record<string, string> = { PROPERTY: "Ακίνητο", CONTACT: "Πελάτης", REQUEST: "Ζήτηση", MANDATE: "Ανάθεση", SHOWING: "Υπόδειξη" };

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults(null);
      setState("idle");
      return;
    }
    const ctrl = new AbortController();
    setState("loading");
    const timer = setTimeout(() => {
      fetch(`${CRM_BASE_PATH}/api/search?${new URLSearchParams({ q: text })}`, { credentials: "same-origin", headers: { accept: "application/json" }, signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const body = (await r.json()) as { results: Result[] };
          setResults(body.results);
          setActive(-1);
          setState("idle");
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setState("error");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  const shown = open && q.trim().length >= 2;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!results?.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      const href = results[active]!.href;
      setOpen(false);
      // Full path incl. basePath; a hard navigation keeps this component dependency-free.
      window.location.assign(`${CRM_BASE_PATH}${href}`);
    }
  }

  return (
    <div className="gsearch" ref={box} role="search">
      <Icon name="search" size={17} className="gsearch__icon" />
      <input
        id={GLOBAL_SEARCH_ID}
        type="search"
        className="gsearch__input"
        placeholder="Αναζήτηση σε επαφές, ακίνητα, ζητήσεις..."
        aria-label="Καθολική αναζήτηση"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {shown && (
        <div className="gsearch__panel" id={listId} role="listbox" aria-label="Αποτελέσματα αναζήτησης">
          {state === "loading" && !results && <p className="gsearch__msg">Αναζήτηση…</p>}
          {state === "error" && <p className="gsearch__msg" role="alert">Η αναζήτηση απέτυχε. Δοκιμάστε ξανά.</p>}
          {results && results.length === 0 && state !== "error" && <p className="gsearch__msg">Κανένα αποτέλεσμα για «{q.trim()}».</p>}
          {results?.map((r, i) => (
            <Link key={`${r.type}-${r.id}`} id={`${listId}-${i}`} href={r.href} role="option" aria-selected={i === active} className="gsearch__item" data-active={i === active || undefined} onClick={() => setOpen(false)}>
              <span className="gsearch__type">{TYPE_LABEL[r.type] ?? r.type}</span>
              <span className="gsearch__title">{r.title}</span>
              {r.subtitle && <span className="gsearch__sub">{r.subtitle}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
