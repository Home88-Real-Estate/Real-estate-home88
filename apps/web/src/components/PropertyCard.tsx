import Link from "next/link";
import type { Locale, PublicPropertySummary } from "@home88/types";
import { formatArea, formatPrice, label, LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS } from "@home88/types";

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

  return (
    <article className="card">
      <Link href={`/property/${property.reference}`} aria-label={property.title}>
        <div className="card__media">
          <div className="badges">
            <span className="badge">{label(LISTING_TYPE_LABELS, property.listingType, locale)}</span>
            {property.isFeatured && <span className="badge badge--accent">Επιλεγμένο</span>}
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
        </div>
      </Link>

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

        <div className="card__meta">
          {[place || null, area, property.bedrooms ? `${property.bedrooms} υπνοδωμάτια` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>

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
