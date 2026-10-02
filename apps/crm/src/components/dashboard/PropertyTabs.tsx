"use client";

import Link from "next/link";
import { useState } from "react";

import { money, relative, type PropertyCard } from "@/lib/dashboard";

import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { StatusBadge } from "../StatusBadge";

/** Recently added / recently updated properties, with cover thumbnails. */
export function PropertyTabs({
  added,
  updated,
  now,
}: {
  added: PropertyCard[];
  updated: PropertyCard[];
  now: string;
}) {
  const [tab, setTab] = useState<"added" | "updated">("added");
  const rows = tab === "added" ? added : updated;

  return (
    <section className="panel" aria-labelledby="props-title">
      <div className="panel__head">
        <h2 id="props-title">Ακίνητα</h2>
        <Link href="/properties" className="btn btn--ghost btn--sm">
          Όλα
        </Link>
      </div>
      <div className="tabs" role="tablist" aria-label="Ακίνητα">
        <button type="button" role="tab" aria-selected={tab === "added"} onClick={() => setTab("added")}>
          Νέα
        </button>
        <button type="button" role="tab" aria-selected={tab === "updated"} onClick={() => setTab("updated")}>
          Πρόσφατες αλλαγές
        </button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Δεν υπάρχουν ακόμη ακίνητα"
          text="Τα ακίνητα που καταχωρίζετε θα εμφανίζονται εδώ."
          action={{ href: "/properties/new", label: "+ Νέο ακίνητο" }}
        />
      ) : (
        <ul className="list" role="tabpanel">
          {rows.map((p) => (
            <li key={p.id}>
              {p.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={p.coverUrl} alt="" loading="lazy" />
              ) : (
                <span className="thumb" aria-hidden="true">
                  <Icon name="building" size={18} />
                </span>
              )}
              <span className="list__main">
                <Link href={`/properties/${p.id}`} className="list__title" title={p.titleEl}>
                  {p.titleEl}
                </Link>
                <span className="list__sub">
                  {p.reference} · {p.areaName ?? p.city ?? "—"} ·{" "}
                  {p.listingType === "RENT" ? `${money(p.monthlyRent ?? p.price)}/μήνα` : money(p.price)}
                </span>
              </span>
              <span className="list__end">
                <StatusBadge value={p.status} kind="property" />
                <br />
                <span>{relative(tab === "added" ? p.createdAt : p.updatedAt, now)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
