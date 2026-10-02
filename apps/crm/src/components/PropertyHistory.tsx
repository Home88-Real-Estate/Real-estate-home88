import { PROPERTY_STATUS_LABELS, label } from "@home88/types";

import { formatDateTime, formatMoney } from "@/lib/format";

type HistoryActor = { id: string; firstName: string; lastName: string } | null;

export type StatusEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
  actor: HistoryActor;
};

export type PriceEntry = {
  id: string;
  fromPrice: unknown;
  toPrice: unknown;
  fromMonthlyRent: unknown;
  toMonthlyRent: unknown;
  createdAt: string;
  actor: HistoryActor;
};

type Row = { id: string; at: string; actor: HistoryActor; text: string; detail?: string | null };

function statusText(entry: StatusEntry): string {
  const to = label(PROPERTY_STATUS_LABELS, entry.toStatus, "el");
  if (!entry.fromStatus) return `Δημιουργία ακινήτου (${to})`;
  return `Κατάσταση: ${label(PROPERTY_STATUS_LABELS, entry.fromStatus, "el")} → ${to}`;
}

function same(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "");
}

function priceText(entry: PriceEntry): string {
  const parts: string[] = [];
  if (!same(entry.fromPrice, entry.toPrice)) {
    parts.push(
      entry.fromPrice == null
        ? `Τιμή: ${formatMoney(entry.toPrice)}`
        : `Τιμή: ${formatMoney(entry.fromPrice)} → ${formatMoney(entry.toPrice)}`,
    );
  }
  if (!same(entry.fromMonthlyRent, entry.toMonthlyRent)) {
    parts.push(
      entry.fromMonthlyRent == null
        ? `Μίσθωμα: ${formatMoney(entry.toMonthlyRent)}`
        : `Μίσθωμα: ${formatMoney(entry.fromMonthlyRent)} → ${formatMoney(entry.toMonthlyRent)}`,
    );
  }
  return parts.join(" · ");
}

function actorName(actor: HistoryActor): string {
  return actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Σύστημα";
}

/** Status and price changes on one timeline, newest first. */
export function PropertyHistory({
  statuses,
  prices,
}: {
  statuses: StatusEntry[];
  prices: PriceEntry[];
}) {
  const rows: Row[] = [
    ...statuses.map((s) => ({
      id: `s-${s.id}`,
      at: s.createdAt,
      actor: s.actor,
      text: statusText(s),
      detail: s.reason,
    })),
    ...prices.map((p) => ({ id: `p-${p.id}`, at: p.createdAt, actor: p.actor, text: priceText(p) })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (rows.length === 0) {
    return (
      <div className="empty">
        Δεν υπάρχει ακόμη ιστορικό. Οι αλλαγές κατάστασης και τιμής θα εμφανίζονται εδώ.
      </div>
    );
  }

  return (
    <ol className="timeline">
      {rows.map((row) => (
        <li key={row.id}>
          <span className="muted mono">{formatDateTime(row.at)}</span>
          <span>{row.text}</span>
          <span className="muted">
            {actorName(row.actor)}
            {row.detail ? ` — ${row.detail}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
