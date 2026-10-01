import Link from "next/link";
import type { Locale, PublicPropertySummary } from "@home88/types";
import { formatArea, formatPrice, label, LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS } from "@home88/types";

import { FavoriteButton } from "./FavoriteButton";
import { CompareButton } from "./CompareButton";

export function PropertyCard({
  property,
  locale = "el",
}: {
  property: PublicPropertySummary;
  locale?: Locale;
}) {
  const area = formatArea(property.area, locale);
  const place = [property.neighborhood, property.areaName, property.city]
    .filter(Boolean)
    .join(", ");

  const stats: string[] = [];
  if (area) stats.push(area);
  if (property.bedrooms) stats.push(`${property.bedrooms} υπν.`);
  if (property.bathrooms) stats.push(`${property.bathrooms} μπ.`);
  if (property.parking) stats.push("Parking");

  return (
    <article className="card">
      <div className="card__media">
        <Link
          href={`/property/${property.reference}`}
          aria-label={property.title}
          style={{ display: "block", height: "100%" }}
        >
          <div className="badges">
            <span className="badge">{label(LISTING_TYPE_LABELS, property.listingType, locale)}</span>
            {property.isFeatured && <span className="badge badge--accent">Επιλεγμένο</span>}
            {property.isNew && <span className="badge badge--accent">Νέο</span>}
            {property.status === "RESERVED" && <span className="badge badge--muted">Κρατημένο</span>}
          </div>
          {property.primaryImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={property.primaryImage}
              alt={property.title}
              loading="lazy"
              decoding="async"
              width={640}
              height={480}
            />
          ) : (
            <div
              style={{
                display: "grid",
                placeItems: "center",
                height: "100%",
                color: "var(--ink-muted)",
                fontSize: "0.85rem",
              }}
            >
              Χωρίς φωτογραφία
            </div>
          )}
        </Link>
        <FavoriteButton reference={property.reference} />
        <CompareButton reference={property.reference} />
      </div>

      <div className="card__body">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="pill">{property.reference}</span>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {label(PROPERTY_TYPE_LABELS, property.propertyType, locale)}
          </span>
        </div>

        <Link href={`/property/${property.reference}`} className="card__title">
          {property.title}
        </Link>

        {place && <div className="card__meta">{place}</div>}

        {stats.length > 0 && (
          <div className="card__stats">
            {stats.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        )}

        <div className="card__price">
          {formatPrice(property.price, property.priceOnRequest, property.listingType, locale)}
        </div>
      </div>
    </article>
  );
}

export function PropertyCardGrid({
  properties,
  locale = "el",
  emptyMessage = "Δεν βρέθηκαν ακίνητα.",
}: {
  properties: PublicPropertySummary[];
  locale?: Locale;
  emptyMessage?: string;
}) {
  if (properties.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }
  return (
    <div className="grid grid--cards">
      {properties.map((p) => (
        <PropertyCard key={p.reference} property={p} locale={locale} />
      ))}
    </div>
  );
}
