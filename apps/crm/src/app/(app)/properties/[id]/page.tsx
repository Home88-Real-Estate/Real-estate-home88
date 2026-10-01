import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveButton } from "@/components/ArchiveButton";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { hasRole, requireRole } from "@/lib/session";

type Media = {
  id: string;
  kind: string;
  storageKey: string;
  isPrimary: boolean;
  altEl: string | null;
};

type PortalListing = {
  id: string;
  state: string;
  externalUrl: string | null;
  lastSyncedAt: string | null;
  portal: { id: string; name: string; code: string };
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
  media: Media[];
  agent: { id: string; firstName: string; lastName: string } | null;
  owner: { id: string; reference: string; firstName: string; lastName: string } | null;
  portalListings: PortalListing[];
};

const BOOL_KEYS = [
  ["parking", "Parking"],
  ["storage", "Storage"],
  ["balcony", "Balcony"],
  ["garden", "Garden"],
  ["pool", "Pool"],
  ["furnished", "Furnished"],
  ["petsAllowed", "Pets allowed"],
  ["seaView", "Sea view"],
  ["hasSolar", "Solar"],
  ["newConstruction", "New construction"],
] as const;

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("AGENT");
  const { id } = await params;

  const result = await apiFetch<{ property: Property }>(`/api/properties/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }

  const p = result.data.property;
  const features = p as unknown as Record<string, boolean>;

  return (
    <>
      <div className="between" style={{ marginBottom: 6 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{p.reference}</span>
            <StatusBadge value={p.status} kind="property" />
            {p.featured && <span className="badge badge--warn">Featured</span>}
            {p.publishedOnWebsite ? (
              <span className="badge badge--ok">On website</span>
            ) : (
              <span className="badge badge--muted">Not on website</span>
            )}
          </div>
          <h1 style={{ margin: 0 }}>{p.titleEl}</h1>
          {p.titleEn && <p className="muted" style={{ margin: 0 }}>{p.titleEn}</p>}
        </div>
        <div className="row">
          <Link href={`/properties/${id}/edit`} className="btn btn--primary btn--sm">
            Edit
          </Link>
          {hasRole(user.role, "ADMIN") && p.status !== "ARCHIVED" && <ArchiveButton id={id} />}
        </div>
      </div>

      <div className="panel">
        <h2>Overview</h2>
        <dl className="dl">
          <dt>Listing type</dt>
          <dd>{p.listingType}</dd>
          <dt>Property type</dt>
          <dd>{p.propertyType}</dd>
          <dt>Condition</dt>
          <dd>{p.condition}</dd>
          <dt>Price</dt>
          <dd>{p.priceOnRequest ? "On request" : formatMoney(p.price)}</dd>
          <dt>Monthly rent</dt>
          <dd>{formatMoney(p.monthlyRent)}</dd>
          <dt>Area</dt>
          <dd>{formatArea(p.area)}</dd>
          <dt>Plot / built</dt>
          <dd>
            {formatArea(p.plotArea)} / {formatArea(p.builtArea)}
          </dd>
          <dt>Bedrooms / bathrooms</dt>
          <dd>
            {p.bedrooms ?? "-"} / {p.bathrooms ?? "-"}
          </dd>
          <dt>Floor</dt>
          <dd>
            {p.floor ?? "-"} of {p.totalFloors ?? "-"}
          </dd>
          <dt>Year built / renovated</dt>
          <dd>
            {p.yearBuilt ?? "-"} / {p.yearRenovated ?? "-"}
          </dd>
          <dt>Heating / energy</dt>
          <dd>
            {p.heating} / {p.energyClass}
          </dd>
          <dt>Location</dt>
          <dd>
            {[p.address, p.neighborhood, p.areaName, p.city, p.region].filter(Boolean).join(", ") || "-"}
          </dd>
          <dt>Agent</dt>
          <dd>{p.agent ? `${p.agent.firstName} ${p.agent.lastName}`.trim() : "-"}</dd>
          <dt>Owner</dt>
          <dd>
            {p.owner ? (
              <Link href={`/contacts/${p.owner.id}`}>
                {p.owner.firstName} {p.owner.lastName} ({p.owner.reference})
              </Link>
            ) : (
              "-"
            )}
          </dd>
          <dt>Video / tour</dt>
          <dd>
            {p.videoUrl ? <a href={p.videoUrl}>{p.videoUrl}</a> : "-"} /{" "}
            {p.virtualTourUrl ? <a href={p.virtualTourUrl}>{p.virtualTourUrl}</a> : "-"}
          </dd>
          <dt>Created / updated</dt>
          <dd>
            {formatDateTime(p.createdAt)} / {formatDateTime(p.updatedAt)}
          </dd>
        </dl>
      </div>

      <div className="panel">
        <h2>Features</h2>
        <dl className="dl">
          {BOOL_KEYS.map(([key, text]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt>{text}</dt>
              <dd>{yesNo(features[key] === true)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="panel">
        <h2>Description (GR)</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{p.descriptionEl}</p>
        {p.descriptionEn && (
          <>
            <h3>Description (EN)</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{p.descriptionEn}</p>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Media ({p.media.length})</h2>
        {p.media.length === 0 ? (
          <div className="empty">No media uploaded.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Storage key</th>
                  <th>Primary</th>
                </tr>
              </thead>
              <tbody>
                {p.media.map((m) => (
                  <tr key={m.id}>
                    <td>{m.kind}</td>
                    <td className="mono">{m.storageKey}</td>
                    <td>{m.isPrimary ? "Yes" : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Portal listings</h2>
        {p.portalListings.length === 0 ? (
          <div className="empty">Not published to any portal.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Portal</th>
                  <th>State</th>
                  <th>Last synced</th>
                  <th>Link</th>
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
                      {listing.externalUrl ? <a href={listing.externalUrl}>Open</a> : "-"}
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
