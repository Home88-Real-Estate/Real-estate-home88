import Link from "next/link";
import { PROPERTY_STATUS_LABELS, label } from "@home88/types";

import { PrintButton } from "@/components/sellers/PrintButton";
import { apiFetch } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

type ReportProperty = {
  id: string;
  reference: string;
  title: string;
  status: string;
  listingType: string;
  price: number | null;
  daysOnMarket: number;
  priceChanges: Array<{ from: number | null; to: number | null; at: string }>;
  enquiries: number;
  viewings: { total: number; completed: number; upcoming: number; feedback: Array<{ at: string; feedback: string | null; outcome: string | null }> };
  offers: { total: number; highest: number | null; open: number };
  transactions: Array<{ reference: string; status: string; agreedAmount: number | null }>;
  valuation: { reference: string; recommendedPrice: number | null; estimate: number | null; low: number | null; high: number | null; finalizedAt: string } | null;
};

/**
 * Activity on the owner's properties, for the conversation with the owner.
 * Interested buyers are counted, never named (the API does not return them).
 */
export async function OwnerReport({ contactId }: { contactId: string }) {
  const result = await apiFetch<{ generatedAt: string; properties: ReportProperty[] }>(`/api/contacts/${encodeURIComponent(contactId)}/owner-report`);
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  const { properties, generatedAt } = result.data;
  return (
    <section className="panel" id="owner-report">
      <div className="panel__head">
        <div><h2>Αναφορά ιδιοκτήτη</h2><p className="panel__sub">Δραστηριότητα στα ακίνητα του ιδιοκτήτη έως {formatDate(generatedAt)}. Οι ενδιαφερόμενοι δεν κατονομάζονται.</p></div>
        <PrintButton />
      </div>
      {properties.map((p) => {
        const rent = p.listingType === "RENT";
        return (
          <article key={p.id} className="report-card">
            <div className="between">
              <strong><Link href={`/properties/${p.id}`}>{p.reference}</Link> · {p.title}</strong>
              <span className="badge badge--muted">{label(PROPERTY_STATUS_LABELS, p.status, "el")}</span>
            </div>
            <dl className="stats">
              <div><dt>Ημέρες στην αγορά</dt><dd>{p.daysOnMarket}</dd></div>
              <div><dt>Τιμή</dt><dd>{p.price != null ? `${formatMoney(p.price)}${rent ? "/μ" : ""}` : "—"}</dd></div>
              <div><dt>Ενδιαφέροντα</dt><dd>{p.enquiries}</dd></div>
              <div><dt>Υποδείξεις</dt><dd>{p.viewings.completed}{p.viewings.upcoming ? ` (+${p.viewings.upcoming})` : ""}</dd></div>
              <div><dt>Προσφορές</dt><dd>{p.offers.total}</dd></div>
              <div><dt>Υψηλότερη προσφορά</dt><dd>{p.offers.highest != null ? formatMoney(p.offers.highest) : "—"}</dd></div>
            </dl>
            {p.priceChanges.length > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Αλλαγές τιμής: {p.priceChanges.map((c) => `${formatDate(c.at)} ${formatMoney(c.from)} → ${formatMoney(c.to)}`).join(" · ")}
              </p>
            )}
            {p.valuation && (
              <p style={{ margin: 0 }}>
                Εκτίμηση {p.valuation.reference} ({formatDate(p.valuation.finalizedAt)}): πρόταση {formatMoney(p.valuation.recommendedPrice)}
                {p.valuation.low != null && p.valuation.high != null && `, εύρος ${formatMoney(p.valuation.low)} – ${formatMoney(p.valuation.high)}`}
              </p>
            )}
            {p.viewings.feedback.length > 0 && (
              <div>
                <strong style={{ fontSize: "0.86rem" }}>Σχόλια από υποδείξεις</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {p.viewings.feedback.map((f, i) => (
                    <li key={i}><span className="muted">{formatDate(f.at)}:</span> {[f.feedback, f.outcome].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
