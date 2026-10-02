"use client";

import { useId, useState } from "react";

import { Icon } from "../Icon";

/**
 * A chart panel with its accessible twin: every chart can be switched to a
 * plain table showing the same numbers (and that table is what screen
 * readers, print and colour-blind readers can always rely on).
 */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
  id,
  className,
}: {
  title: string;
  subtitle?: string;
  table: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  return (
    <section className={className ? `panel ${className}` : "panel"} id={id} aria-labelledby={headingId}>
      <div className="panel__head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p className="panel__sub">{subtitle}</p>}
        </div>
        <div className="chart-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setAsTable((value) => !value)}
            aria-pressed={asTable}
            title={asTable ? "Εμφάνιση γραφήματος" : "Εμφάνιση πίνακα"}
          >
            <Icon name={asTable ? "barChart" : "table"} size={16} />
            {asTable ? "Γράφημα" : "Πίνακας"}
          </button>
        </div>
      </div>
      {asTable ? <div className="table-scroll">{table}</div> : children}
    </section>
  );
}
