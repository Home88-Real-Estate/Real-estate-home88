"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { COMPARE_EVENT, COMPARE_MAX, readCompare, writeCompare } from "./compare-store";

export function CompareBar() {
  const pathname = usePathname();
  const [refs, setRefs] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setRefs(readCompare());
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COMPARE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (refs.length === 0 || pathname === "/compare") return null;

  return (
    <div className="compare-bar" role="region" aria-label="Σύγκριση ακινήτων">
      <div className="wrap compare-bar__inner">
        <div className="compare-bar__items">
          {refs.map((r) => (
            <span className="chip" key={r}>
              {r}
              <button
                type="button"
                aria-label={`Αφαίρεση ${r} από τη σύγκριση`}
                onClick={() => writeCompare(readCompare().filter((x) => x !== r))}
              >
                ×
              </button>
            </span>
          ))}
          {refs.length < COMPARE_MAX && (
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              Έως {COMPARE_MAX} ακίνητα
            </span>
          )}
        </div>
        <div className="row">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => writeCompare([])}>
            Καθαρισμός
          </button>
          <Link href={`/compare?refs=${refs.join(",")}`} className="btn btn--primary btn--sm">
            Σύγκριση ({refs.length})
          </Link>
        </div>
      </div>
    </div>
  );
}
