import Link from "next/link";
import { notFound } from "next/navigation";
import { fieldDef } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { setRequestStatus } from "@/actions/work";
import { EmptyState } from "@/components/EmptyState";
import { apiFetch } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { REQUEST_STATUS_CLASS, REQUEST_STATUS_LABEL, priceRange } from "@/lib/labels";
import { requireRole } from "@/lib/session";

type Request = {
  id: string;
  reference: string;
  status: string;
  listingType: string;
  propertyTypes: string[];
  areas: string[];
  minPrice: string | null;
  maxPrice: string | null;
  minArea: string | null;
  maxArea: string | null;
  minBedrooms: number | null;
  minBathrooms: number | null;
  minFloor: number | null;
  minYearBuilt: number | null;
  features: string[];
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  rating: number | null;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
};

type Match = {
  score: number;
  matched: string[];
  missing: string[];
  property: {
    id: string;
    reference: string;
    titleEl: string;
    propertyType: string;
    price: number | null;
    monthlyRent: number | null;
    priceOnRequest: boolean;
    area: number | null;
    bedrooms: number | null;
    areaName: string | null;
    city: string | null;
  };
};

const NEXT_STATUS: Record<string, Array<[string, string]>> = {
  ACTIVE: [["PAUSED", "Παύση"], ["FULFILLED", "Ολοκληρώθηκε"], ["CANCELLED", "Ακύρωση"]],
  PAUSED: [["ACTIVE", "Επανενεργοποίηση"], ["CANCELLED", "Ακύρωση"]],
  FULFILLED: [["ACTIVE", "Επανενεργοποίηση"]],
  CANCELLED: [["ACTIVE", "Επανενεργοποίηση"]],
};

function scoreClass(score: number): string {
  return score >= 85 ? "score score--high" : score >= 65 ? "score score--mid" : "score";
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const result = await apiFetch<{ request: Request; matches: Match[]; candidates: number }>(`/api/requests/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const { request: r, matches, candidates } = result.data;
  const criteria: Array<[string, string]> = [
    ["Για", label(LISTING_TYPE_LABELS, r.listingType, "el")],
    ["Τύποι", r.propertyTypes.length ? r.propertyTypes.map((t) => label(PROPERTY_TYPE_LABELS, t, "el")).join(", ") : "Όλοι"],
    ["Περιοχές", r.areas.join(", ") || "Όλες"],
    ["Τιμή", priceRange(r.minPrice, r.maxPrice)],
    ["Εμβαδόν", r.minArea || r.maxArea ? `${r.minArea ? `από ${Number(r.minArea)}` : ""}${r.maxArea ? ` έως ${Number(r.maxArea)}` : ""} m²` : "—"],
    ...(r.minBedrooms != null ? [["Υπνοδωμάτια", `${r.minBedrooms}+`] as [string, string]] : []),
    ...(r.minBathrooms != null ? [["Μπάνια", `${r.minBathrooms}+`] as [string, string]] : []),
    ...(r.minFloor != null ? [["Όροφος", `${r.minFloor}+`] as [string, string]] : []),
    ...(r.minYearBuilt != null ? [["Κατασκευή", `από ${r.minYearBuilt}`] as [string, string]] : []),
    ...(r.features.length ? [["Παροχές", r.features.map((f) => fieldDef(f)?.label ?? f).join(", ")] as [string, string]] : []),
  ];

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{r.reference}</span>
            <span className={REQUEST_STATUS_CLASS[r.status] ?? "badge"}>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</span>
            {r.rating ? <span className="muted">{"★".repeat(r.rating)}</span> : null}
          </div>
          <h1 style={{ margin: 0 }}>{r.clientName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {[r.clientPhone, r.clientEmail].filter(Boolean).join(" · ") || "Χωρίς στοιχεία επικοινωνίας"}
          </p>
        </div>
        <div className="row">
          {(NEXT_STATUS[r.status] ?? []).map(([status, text]) => (
            <form key={status} action={setRequestStatus}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value={status} />
              <button type="submit" className="btn btn--outline btn--sm">
                {text}
              </button>
            </form>
          ))}
          <Link href={`/requests/${r.id}/edit`} className="btn btn--primary btn--sm">
            Επεξεργασία
          </Link>
        </div>
      </div>

      <div className="panel">
        <h2>Κριτήρια</h2>
        <dl className="dl">
          {criteria.map(([name, value]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <dt>Σύμβουλος</dt>
          <dd>{r.assignedTo ? `${r.assignedTo.firstName} ${r.assignedTo.lastName}` : "—"}</dd>
          <dt>Καταχώριση / ισχύς</dt>
          <dd>
            {formatDate(r.createdAt)} / {r.expiresAt ? formatDate(r.expiresAt) : "χωρίς λήξη"}
          </dd>
        </dl>
        {r.notes && <p style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{r.notes}</p>}
      </div>

      <div className="panel">
        <div className="panel__head">
          <div>
            <h2>Ακίνητα που ταιριάζουν</h2>
            <p className="panel__sub">
              Από {candidates} ενεργά ακίνητα του ίδιου είδους. Η βαθμολογία είναι το ποσοστό των κριτηρίων που
              καλύπτονται (εμφανίζονται από 40%).
            </p>
          </div>
        </div>
        {matches.length === 0 ? (
          <EmptyState
            compact
            title="Κανένα ακίνητο δεν ταιριάζει ακόμη"
            text="Όταν καταχωριστεί ακίνητο που ταιριάζει, θα εμφανιστεί εδώ."
          />
        ) : (
          <ul className="list matchlist">
            {matches.map((m) => (
              <li key={m.property.id}>
                <span className={scoreClass(m.score)} aria-label={`Ταίριασμα ${m.score}%`}>
                  {m.score}%
                </span>
                <span className="list__main">
                  <Link href={`/properties/${m.property.id}`} className="list__title" title={m.property.titleEl}>
                    {m.property.reference} · {m.property.titleEl}
                  </Link>
                  <span className="list__sub">
                    {label(PROPERTY_TYPE_LABELS, m.property.propertyType, "el")}
                    {m.property.areaName || m.property.city ? ` · ${m.property.areaName ?? m.property.city}` : ""}
                    {" · "}
                    {m.property.priceOnRequest
                      ? "Τιμή κατόπιν επικοινωνίας"
                      : formatMoney(r.listingType === "RENT" ? m.property.monthlyRent : m.property.price)}
                    {m.property.area ? ` · ${m.property.area} m²` : ""}
                    {m.property.bedrooms != null ? ` · ${m.property.bedrooms} υ/δ` : ""}
                  </span>
                  <span className="matchwhy">
                    {m.matched.map((t) => (
                      <span key={t} className="matchwhy__ok">✓ {t}</span>
                    ))}
                    {m.missing.map((t) => (
                      <span key={t} className="matchwhy__no">✗ {t}</span>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
