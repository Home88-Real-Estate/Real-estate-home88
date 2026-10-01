"use client";

import { useEffect, useState } from "react";

import { COMPARE_EVENT, COMPARE_MAX, isCompared, readCompare, toggleCompare } from "./compare-store";

export function CompareButton({ reference }: { reference: string }) {
  const [on, setOn] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => {
      const selected = isCompared(reference);
      setOn(selected);
      setFull(!selected && readCompare().length >= COMPARE_MAX);
    };
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COMPARE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [reference]);

  return (
    <button
      type="button"
      className="fav fav--compare"
      aria-pressed={on}
      disabled={full}
      aria-label={on ? "Αφαίρεση από τη σύγκριση" : "Προσθήκη στη σύγκριση"}
      title={full ? `Έως ${COMPARE_MAX} ακίνητα` : on ? "Αφαίρεση από τη σύγκριση" : "Σύγκριση"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!full) toggleCompare(reference);
      }}
    >
      {on ? "✓" : "⇄"}
    </button>
  );
}
