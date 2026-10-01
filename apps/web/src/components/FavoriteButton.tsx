"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "home88:favorites";

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Client-side saved properties. Stores only public property references — no
 * personal data and no token — so it does not require a consent category and
 * never leaves the browser. A server-backed account feature would replace this.
 */
export function FavoriteButton({ reference }: { reference: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(read().includes(reference));
  }, [reference]);

  function toggle() {
    const next = new Set(read());
    if (next.has(reference)) next.delete(reference);
    else next.add(reference);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage disabled (private mode) — the button simply does not persist */
    }
    setOn(next.has(reference));
  }

  return (
    <button
      type="button"
      className="fav"
      aria-pressed={on}
      aria-label={on ? "Αφαίρεση από τα αγαπημένα" : "Προσθήκη στα αγαπημένα"}
      title={on ? "Αφαίρεση από τα αγαπημένα" : "Αποθήκευση ακινήτου"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
    >
      {on ? "♥" : "♡"}
    </button>
  );
}
