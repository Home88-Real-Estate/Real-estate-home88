import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPropertyByReference, listRecentProperties } from "@/lib/property";
import { PropertyCard } from "@/components/PropertyCard";
import { LeadForm } from "@/components/LeadForm";
import { COMPANY, SITE_URL } from "@/lib/config";
import {
  formatArea,
  formatPrice,
  label,
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@home88/types";

export const revalidate = 300;

type Props = { params: Promise<{ reference: string }> };

function isReference(v: string): boolean {
  return /^H88-\d{6}$/i.test(v);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { reference } = await params;
  if (!isReference(reference)) return { title: "Το ακίνητο δεν βρέθηκε", robots: { index: false } };

  const property = await getPropertyByReference(reference, "el");
  if (!property) return { title: "Το ακίνητο δεν βρέθηκε", robots: { index: false } };

  const area = formatArea(property.area, "el");
  const price = formatPrice(property.price, property.priceOnRequest, property.listingType, "el");
  const place = [property.neighborhood, property.city].filter(Boolean).join(", ");

  return {
    title: `${property.title}${place ? ` — ${place}` : ""} — ${price}`,
    description:
      property.description.slice(0, 300) ||
      `${label(LISTING_TYPE_LABELS, property.listingType, "el")} — ${property.title}. ${area ?? ""}`,
    alternates: { canonical: `/property/${property.reference}` },
    openGraph: {
      type: "website",
      title: property.title,
      description: property.description.slice(0, 200),
      images: property.primaryImage ? [{ url: property.primaryImage }] : undefined,
    },
  };
}

export default async function PropertyDetailPage({ params }: Props) {
  const { reference } = await params;
  if (!isReference(reference)) notFound();

  const property = await getPropertyByReference(reference, "el");
  if (!property) notFound();

  const price = formatPrice(property.price, property.priceOnRequest, property.listingType, "el");
  const area = formatArea(property.area, "el");
  const place = [property.neighborhood, property.areaName, property.city].filter(Boolean).join(", ");

  const similar = (await listRecentProperties("el", 7))
    .filter((p) => p.reference !== property.reference)
    .slice(0, 3);

  /**
   * schema.org markup. Every value comes from data we actually hold, so the
   * markup cannot claim a rating or a price that does not exist — Google
   * penalises rich results that disagree with the page.
   */
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: property.title,
    description: property.description.slice(0, 500),
    url: `${SITE_URL}/property/${property.reference}`,
    ...(property.images.length > 0
      ? { image: property.images.slice(0, 8).map((i) => (i.url.startsWith("http") ? i.url : `${SITE_URL}${i.url}`)) }
      : {}),
    ...(property.price != null && !property.priceOnRequest
      ? {
          offers: {
            "@type": "Offer",
            price: property.price,
            priceCurrency: "EUR",
            availability:
              property.status === "ACTIVE" ||
              property.status === "UNDER_OFFER" ||
              property.status === "RESERVED"
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
          },
        }
      : {}),
    ...(property.latitude != null && property.longitude != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: property.latitude,
            longitude: property.longitude,
          },
        }
      : {}),
    ...(place
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: property.city ?? undefined,
            addressRegion: property.areaName ?? undefined,
            addressCountry: "GR",
          },
        }
      : {}),
    numberOfRooms: property.bedrooms ?? undefined,
    floorSize: property.area != null
      ? { "@type": "QuantitativeValue", value: property.area, unitCode: "MTK" }
      : undefined,
    broker: { "@type": "RealEstateAgent", name: COMPANY.legalName, url: SITE_URL },
    // reference is our stable identifier, so it is safe to emit.
    identifier: property.reference,
  };

  // Emit breadcrumbs so the listing shows a path rather than a bare URL.
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Αρχική", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Ακίνητα", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: property.title, item: `${SITE_URL}/property/${property.reference}` },
    ],
  };

  const specs: Array<[string, string | null]> = [
    ["Κωδικός", property.reference],
    ["Τύπος", label(PROPERTY_TYPE_LABELS, property.propertyType, "el")],
    ["Συναλλαγή", label(LISTING_TYPE_LABELS, property.listingType, "el")],
    ["Εμβαδόν", area],
    ["Υπνοδωμάτια", property.bedrooms != null ? String(property.bedrooms) : null],
    ["Μπάνια", property.bathrooms != null ? String(property.bathrooms) : null],
    ["Όροφος", property.floor != null ? String(property.floor) : null],
    ["Έτος κατασκευής", property.yearBuilt != null ? String(property.yearBuilt) : null],
    ["Έτος ανακαίνισης", property.yearRenovated != null ? String(property.yearRenovated) : null],
    ["Ενεργειακή κλάση", property.energyClass !== "NOT_AVAILABLE" ? property.energyClass : null],
    ["Θέρμανση", property.heating !== "NOT_AVAILABLE" ? property.heating : null],
  ];

  const facts: string[] = [];
  if (area) facts.push(area);
  if (property.bedrooms != null) facts.push(`${property.bedrooms} υπνοδωμάτια`);
  if (property.bathrooms != null) facts.push(`${property.bathrooms} μπάνια`);
  if (property.floor != null) facts.push(`Όροφος ${property.floor}`);
  if (property.parking) facts.push("Parking");

  const flags: Array<[string, boolean]> = [
    ["Parking", property.parking],
    ["Αποθήκη", property.storage],
    ["Μπαλκόνι", property.balcony],
    ["Κήπος", property.garden],
    ["Πισίνα", property.pool],
    ["Θέα θάλασσα", property.seaView],
    ["Επιπλωμένο", property.furnished],
    ["Κατοικίδια", property.petsAllowed],
    ["Φωτοβολταϊκά", property.hasSolar],
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />

      <div className="wrap section">
        <nav aria-label="Διαδρομή" style={{ fontSize: "0.85rem", marginBottom: 14 }}>
          <Link href="/">Αρχική</Link> <span className="muted">/</span>{" "}
          <Link href="/properties">Ακίνητα</Link> <span className="muted">/</span>{" "}
          <span className="muted">{property.reference}</span>
        </nav>

        <div className="gallery">
          <div className="gallery__main">
            {property.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={property.images[0].url} alt={property.images[0].alt || property.title} width={1280} height={800} />
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--ink-muted)" }}>
                Χωρίς φωτογραφία
              </div>
            )}
          </div>
          {property.images.slice(1, 7).map((img, i) => (
            <div className="gallery__thumb" key={`${img.url}-${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt || property.title} loading="lazy" width={320} height={240} />
            </div>
          ))}
        </div>

        <div className="grid grid--2" style={{ marginTop: 28, alignItems: "start" }}>
          <div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="pill">{property.reference}</span>
              <span className="pill">{label(LISTING_TYPE_LABELS, property.listingType, "el")}</span>
              {property.status === "UNDER_OFFER" && <span className="pill">Υπό προσφορά</span>}
              {property.status === "RESERVED" && <span className="pill">Κρατημένο</span>}
            </div>

            <h1 style={{ marginTop: 12 }}>{property.title}</h1>
            {property.titleSecondary && <p className="muted" style={{ marginTop: -6 }}>{property.titleSecondary}</p>}
            {place && <p className="muted">{place}</p>}

            {facts.length > 0 && (
              <div className="detail-facts">
                {facts.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            )}

            <div style={{ fontSize: "1.7rem", fontWeight: 800, marginBlock: 12 }}>{price}</div>

            <dl className="specs">
              {specs.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>

            <h2 style={{ marginTop: 28 }}>Περιγραφή</h2>
            {/* whitespace-pre-line so paragraph breaks from the editor survive,
                without ever using dangerouslySetInnerHTML on user text. */}
            <div className="prose" style={{ whiteSpace: "pre-line" }}>{property.description}</div>

            <h2 style={{ marginTop: 28 }}>Παροχές</h2>
            <div className="row">
              {flags.map(([name, on]) => (
                <span key={name} className="pill" style={{ opacity: on ? 1 : 0.45 }}>
                  {on ? "✓" : "—"} {name}
                </span>
              ))}
            </div>

            {property.virtualTourUrl && (
              <p style={{ marginTop: 18 }}>
                <a href={property.virtualTourUrl} rel="noopener noreferrer nofollow" target="_blank" className="btn btn--outline btn--sm">
                  Εικονική περιήγηση
                </a>
              </p>
            )}

            {property.latitude != null && property.longitude != null && (
              <>
                <h2 style={{ marginTop: 28 }}>Τοποθεσία</h2>
                {/*
                  A static map link rather than an embedded map. An embedded
                  Google Map sets cookies and receives the visitor's IP before
                  any consent has been given; this does not.
                */}
                <a
                  className="btn btn--outline"
                  href={`https://www.google.com/maps/search/?api=1&query=${property.latitude},${property.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Προβολή στους χάρτες
                </a>
                <p className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>
                  Η ακριβής θέση ενδέχεται να αποκλίνει για λόγους ασφαλείας.
                </p>
              </>
            )}
          </div>

          <aside style={{ position: "sticky", top: 90 }}>
            <div className="searchpanel" style={{ marginTop: 0 }}>
              <h2 style={{ fontSize: "1.15rem" }}>Ενδιαφέρεστε;</h2>
              <p className="muted" style={{ fontSize: "0.9rem" }}>
                Συμπληρώστε τη φόρμα και θα επικοινωνήσουμε μαζί σας.
                {property.agent ? ` Υπεύθυνος: ${property.agent.name}.` : ""}
              </p>
              <LeadForm propertyReference={property.reference} />
            </div>
          </aside>
        </div>

        {similar.length > 0 && (
          <section style={{ marginTop: 44 }}>
            <h2>Παρόμοια ακίνητα</h2>
            <div className="grid grid--cards" style={{ marginTop: 16 }}>
              {similar.map((p) => (
                <PropertyCard key={p.reference} property={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
