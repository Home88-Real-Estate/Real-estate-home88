import Link from "next/link";
import { notFound } from "next/navigation";

import { MediaPanel } from "@/components/MediaPanel";
import type { MediaItemData } from "@/components/MediaItem";
import { PropertyHistory, type PriceEntry, type StatusEntry } from "@/components/PropertyHistory";
import { PropertyStatusActions } from "@/components/PropertyStatusActions";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { CONDITION_LABELS, describeProperty, listingProfileFor, profileFor, type PropertyCondition } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { hasRole, requireRole } from "@/lib/session";

type PortalListing = {
  id: string;
  state: string;
  externalUrl: string | null;
  lastSyncedAt: string | null;
  portal: { id: string; name: string; code: string };
};

type RequestMatch = {
  score: number;
  matched: string[];
  missing: string[];
  request: { id: string; reference: string; clientName: string; rating: number | null };
};

type Property = {
  id: string;
  reference: string;
  slug: string;
  listingType: string;
  propertyType: string;
  status: string;
  condition: string;
  titleEl: string;
  titleEn: string | null;
  descriptionEl: string;
  descriptionEn: string | null;
  price: unknown;
  priceOnRequest: boolean;
  monthlyRent: unknown;
  area: unknown;
  plotArea: unknown;
  builtArea: unknown;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  yearRenovated: number | null;
  heating: string;
  energyClass: string;
  region: string | null;
  city: string | null;
  areaName: string | null;
  neighborhood: string | null;
  address: string | null;
  videoUrl: string | null;
  virtualTourUrl: string | null;
  publishedOnWebsite: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  agent: { id: string; firstName: string; lastName: string } | null;
  owner: { id: string; reference: string; firstName: string; lastName: string } | null;
  portalListings: PortalListing[];
};

function listingPriceLabel(listingType: string): string {
  return listingProfileFor(listingType).priceLabel;
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("AGENT");
  const { id } = await params;

  const [result, mediaResult, historyResult, matchResult] = await Promise.all([
    apiFetch<{ property: Property; allowedTransitions: string[]; canEdit: boolean }>(
      `/api/properties/${id}`,
    ),
    apiFetch<{ media: MediaItemData[] }>(`/api/properties/${id}/media`),
    apiFetch<{ statuses: StatusEntry[]; prices: PriceEntry[] }>(`/api/properties/${id}/history`),
    apiFetch<{ matches: RequestMatch[] }>(`/api/properties/${id}/matching-requests`),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }

  const p = result.data.property;
  const { allowedTransitions, canEdit } = result.data;
  const media = mediaResult.ok ? mediaResult.data.media : [];
  const described = describeProperty(p as unknown as Record<string, unknown>);
  const pricing = listingProfileFor(p.listingType);
  const priceValue = pricing.priceField === "price" ? p.price : p.monthlyRent;
  const perSqm =
    pricing.priceField === "price" && Number(p.price) > 0 && Number(p.area) > 0
      ? formatMoney(Number(p.price) / Number(p.area))
      : null;

  return (
    <>
      <div className="between" style={{ marginBottom: 6 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{p.reference}</span>
            <StatusBadge value={p.status} kind="property" />
            {p.featured && <span className="badge badge--warn">Προβεβλημένο</span>}
            {p.publishedOnWebsite ? (
              <span className="badge badge--ok">Στον ιστότοπο</span>
            ) : (
              <span className="badge badge--muted">Εκτός ιστότοπου</span>
            )}
          </div>
          <h1 style={{ margin: 0 }}>{p.titleEl}</h1>
          {p.titleEn && <p className="muted" style={{ margin: 0 }}>{p.titleEn}</p>}
        </div>
        {canEdit && (
          <div className="row">
            <Link href={`/properties/${id}/edit`} className="btn btn--primary btn--sm">
              Επεξεργασία
            </Link>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Κατάσταση</h2>
        <PropertyStatusActions id={id} allowed={allowedTransitions} />
      </div>

      <div className="panel">
        <h2>Βασικά στοιχεία</h2>
        <dl className="dl">
          <dt>Είδος αγγελίας</dt>
          <dd>{label(LISTING_TYPE_LABELS, p.listingType, "el")}</dd>
          <dt>Τύπος ακινήτου</dt>
          <dd>{label(PROPERTY_TYPE_LABELS, p.propertyType, "el")}</dd>
          {profileFor(p.propertyType).conditions && (
            <>
              <dt>Κατάσταση ακινήτου</dt>
              <dd>{CONDITION_LABELS[p.condition as PropertyCondition] ?? p.condition}</dd>
            </>
          )}
          <dt>{listingPriceLabel(p.listingType)}</dt>
          <dd>
            {p.priceOnRequest ? "Κατόπιν επικοινωνίας" : formatMoney(priceValue)}
            {pricing.priceField === "monthlyRent" && !p.priceOnRequest && priceValue != null ? " / μήνα" : ""}
            {perSqm && !p.priceOnRequest ? <span className="muted"> · {perSqm} ανά m²</span> : null}
          </dd>
          {described.pricing.map(([name, value]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <dt>Τοποθεσία</dt>
          <dd>
            {[p.address, p.neighborhood, p.areaName, p.city, p.region].filter(Boolean).join(", ") || "-"}
          </dd>
          <dt>Σύμβουλος</dt>
          <dd>{p.agent ? `${p.agent.firstName} ${p.agent.lastName}`.trim() : "-"}</dd>
          <dt>Ιδιοκτήτης</dt>
          <dd>
            {p.owner ? (
              <Link href={`/contacts/${p.owner.id}`}>
                {p.owner.firstName} {p.owner.lastName} ({p.owner.reference})
              </Link>
            ) : (
              "-"
            )}
          </dd>
          <dt>Βίντεο / εικονική περιήγηση</dt>
          <dd>
            {p.videoUrl ? <a href={p.videoUrl}>Βίντεο</a> : "-"} /{" "}
            {p.virtualTourUrl ? <a href={p.virtualTourUrl}>Περιήγηση</a> : "-"}
          </dd>
          <dt>Δημιουργία / ενημέρωση</dt>
          <dd>
            {formatDateTime(p.createdAt)} / {formatDateTime(p.updatedAt)}
          </dd>
        </dl>
      </div>

      <div className="panel">
        <h2>{profileFor(p.propertyType).title}</h2>
        {described.characteristics.length === 0 ? (
          <div className="empty">Δεν έχουν συμπληρωθεί χαρακτηριστικά ακόμη.</div>
        ) : (
          <dl className="dl">
            {described.characteristics.map(([name, value]) => (
              <div key={name} style={{ display: "contents" }}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {described.features.length > 0 && (
        <div className="panel">
          <h2>Παροχές</h2>
          <ul className="feature-list">
            {described.features.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <h2>Περιγραφή</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{p.descriptionEl}</p>
        {p.descriptionEn && (
          <>
            <h3>Περιγραφή (αγγλικά)</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{p.descriptionEn}</p>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel__head">
          <div>
            <h2>Ζητήσεις που ταιριάζουν</h2>
            <p className="panel__sub">Ενεργές ζητήσεις πελατών για τις οποίες είναι κατάλληλο το ακίνητο.</p>
          </div>
          <Link href="/requests/new" className="btn btn--ghost btn--sm">
            Νέα ζήτηση
          </Link>
        </div>
        {!matchResult.ok ? (
          <div className="notice notice--danger">{matchResult.error.message}</div>
        ) : matchResult.data.matches.length === 0 ? (
          <div className="empty">Καμία ενεργή ζήτηση δεν ταιριάζει ακόμη.</div>
        ) : (
          <ul className="list matchlist">
            {matchResult.data.matches.map((m) => (
              <li key={m.request.id}>
                <span className={m.score >= 85 ? "score score--high" : m.score >= 65 ? "score score--mid" : "score"}>{m.score}%</span>
                <span className="list__main">
                  <Link href={`/requests/${m.request.id}`} className="list__title">
                    {m.request.clientName} <span className="mono muted">{m.request.reference}</span>
                  </Link>
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

      <MediaPanel
        propertyId={id}
        media={media}
        canModerate={hasRole(user.role, "MANAGER")}
      />

      <div className="panel">
        <h2>Ιστορικό</h2>
        {historyResult.ok ? (
          <PropertyHistory statuses={historyResult.data.statuses} prices={historyResult.data.prices} />
        ) : (
          <div className="notice notice--danger">{historyResult.error.message}</div>
        )}
      </div>

      <div className="panel">
        <h2>Δημοσιεύσεις σε portals</h2>
        {p.portalListings.length === 0 ? (
          <div className="empty">Δεν έχει δημοσιευτεί σε κανένα portal.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Portal</th>
                  <th>Κατάσταση</th>
                  <th>Τελευταίος συγχρονισμός</th>
                  <th>Σύνδεσμος</th>
                </tr>
              </thead>
              <tbody>
                {p.portalListings.map((listing) => (
                  <tr key={listing.id}>
                    <td>{listing.portal.name}</td>
                    <td>
                      <StatusBadge value={listing.state} kind="portal" />
                    </td>
                    <td>{listing.lastSyncedAt ? formatDate(listing.lastSyncedAt) : "-"}</td>
                    <td>
                      {listing.externalUrl ? <a href={listing.externalUrl}>Άνοιγμα</a> : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
