import type { Metadata } from "next";
import Link from "next/link";

import { PropertyCardGrid } from "@/components/PropertyCard";
import { CategoryNav } from "@/components/CategoryNav";
import { searchProperties, type SearchParams } from "@/lib/property";
import { propertySearchSchema } from "@home88/validation";
import { label, LISTING_TYPE_LABELS } from "@home88/types";

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Search params are parsed through the shared Zod schema, not read straight
 * off the query string. That means a hand-crafted URL cannot inject a filter
 * the UI does not offer, and a bad value degrades to "ignored" rather than
 * reaching Prisma as an unexpected type.
 */
function parseSearch(raw: RawParams): SearchParams {
  const candidate: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    candidate[k] = first(v);
  }

  const parsed = propertySearchSchema.safeParse(candidate);
  const data = parsed.success ? parsed.data : propertySearchSchema.parse({});

  return {
    listingType: data.listingType,
    propertyType: data.propertyType,
    city: data.city || undefined,
    areaName: data.areaName || undefined,
    neighborhood: data.neighborhood || undefined,
    minPrice: data.minPrice ?? null,
    maxPrice: data.maxPrice ?? null,
    minArea: data.minArea ?? null,
    maxArea: data.maxArea ?? null,
    bedrooms: data.bedrooms ?? null,
    energyClass: data.energyClass,
    parking: data.parking,
    pool: data.pool,
    garden: data.garden,
    seaView: data.seaView,
    furnished: data.furnished,
    petsAllowed: data.petsAllowed,
    newConstruction: data.newConstruction,
    q: data.q || undefined,
    sort: data.sort,
    page: data.page,
    limit: data.limit,
  };
}

/** Builds a canonical, crawlable URL for the current filter set. */
function canonicalFrom(params: SearchParams): string {
  const usp = new URLSearchParams();
  const setters: Array<[string, unknown]> = [
    ["listingType", params.listingType],
    ["propertyType", params.propertyType],
    ["city", params.city],
    ["areaName", params.areaName],
    ["neighborhood", params.neighborhood],
    ["minPrice", params.minPrice],
    ["maxPrice", params.maxPrice],
    ["minArea", params.minArea],
    ["maxArea", params.maxArea],
    ["bedrooms", params.bedrooms],
    ["energyClass", params.energyClass],
    ["sort", params.sort],
    ["page", params.page && params.page > 1 ? params.page : undefined],
  ];
  for (const [k, v] of setters) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const qs = usp.toString();
  return `/properties${qs ? `?${qs}` : ""}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}): Promise<Metadata> {
  const params = parseSearch(await searchParams);

  const parts: string[] = [];
  if (params.listingType) parts.push(label(LISTING_TYPE_LABELS, params.listingType, "el"));
  if (params.propertyType) parts.push(params.propertyType);
  if (params.city) parts.push(params.city);
  if (params.neighborhood) parts.push(params.neighborhood);
  parts.push("Ακίνητα");

  const title = parts.join(" · ");
  const canonical = canonicalFrom(params);

  return {
    title,
    description: `Αγγελίες για ${title.toLowerCase()}. Φίλτρα τιμής, εμβαδού, υπνοδωματίων και παροχών.`,
    // Self-referencing canonical that reflects the filters actually applied,
    // so paginated and filtered views are not treated as duplicates of "/".
    alternates: { canonical },
    // Filtered and paginated combinations should be followed, not indexed
    // individually — the unparameterised page is the indexable entry point.
    robots:
      params.page && params.page > 1
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}

const TYPE_OPTIONS: Array<[string, string]> = [
  ["", "Όλοι οι τύποι"],
  ["APARTMENT", "Διαμέρισμα"],
  ["MAISONETTE", "Μεζονέτα"],
  ["HOUSE", "Μονοκατοικία"],
  ["VILLA", "Βίλα"],
  ["STUDIO", "Στούντιο"],
  ["OFFICE", "Γραφείο"],
  ["SHOP", "Κατάστημα"],
  ["WAREHOUSE", "Αποθήκη"],
  ["BUILDING", "Κτίριο"],
  ["HOTEL", "Ξενοδοχείο"],
  ["LAND", "Γη"],
  ["PLOT", "Οικόπεδο"],
  ["PARKING", "Parking"],
  ["INDUSTRIAL", "Βιομηχανικό"],
  ["OTHER", "Άλλο"],
];

const ENERGY_OPTIONS: Array<[string, string]> = [
  ["", "Οποιαδήποτε"],
  ["A_PLUS", "A+"],
  ["A", "A"],
  ["B", "B"],
  ["C", "C"],
  ["D", "D"],
  ["E", "E"],
  ["F", "F"],
  ["G", "G"],
  ["NOT_AVAILABLE", "Μη διαθέσιμη"],
];

const FEATURE_FLAGS: Array<[keyof SearchParams, string]> = [
  ["parking", "Parking"],
  ["pool", "Πισίνα"],
  ["garden", "Κήπος"],
  ["seaView", "Θέα θάλασσα"],
  ["furnished", "Επιπλωμένο"],
  ["petsAllowed", "Κατοικίδια"],
  ["newConstruction", "Νέα κατασκευή"],
];

function categoryKey(propertyType: string | undefined): string | undefined {
  if (propertyType === "APARTMENT" || propertyType === "MAISONETTE" || propertyType === "HOUSE" || propertyType === "VILLA" || propertyType === "STUDIO") {
    return "APARTMENT";
  }
  if (propertyType === "SHOP" || propertyType === "OFFICE" || propertyType === "WAREHOUSE" || propertyType === "BUILDING" || propertyType === "HOTEL" || propertyType === "INDUSTRIAL") {
    return "SHOP";
  }
  if (propertyType === "PLOT" || propertyType === "LAND") return "PLOT";
  if (propertyType) return "OTHER";
  return undefined;
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = parseSearch(await searchParams);
  const result = await searchProperties("el", params);

  const headingBits = [
    params.listingType ? label(LISTING_TYPE_LABELS, params.listingType, "el") : "Ακίνητα",
    params.city,
    params.neighborhood,
  ].filter(Boolean);

  function pageHref(page: number): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries({
      listingType: params.listingType,
      propertyType: params.propertyType,
      city: params.city,
      areaName: params.areaName,
      neighborhood: params.neighborhood,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      minArea: params.minArea,
      maxArea: params.maxArea,
      bedrooms: params.bedrooms,
      energyClass: params.energyClass,
      parking: params.parking ? "true" : undefined,
      pool: params.pool ? "true" : undefined,
      garden: params.garden ? "true" : undefined,
      seaView: params.seaView ? "true" : undefined,
      furnished: params.furnished ? "true" : undefined,
      petsAllowed: params.petsAllowed ? "true" : undefined,
      newConstruction: params.newConstruction ? "true" : undefined,
      q: params.q,
      sort: params.sort,
    })) {
      if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
    }
    if (page > 1) usp.set("page", String(page));
    const qs = usp.toString();
    return `/properties${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <CategoryNav active={categoryKey(params.propertyType)} />

      <div className="wrap section">
        <h1 style={{ marginBottom: 6 }}>{headingBits.join(" · ")}</h1>
        <p className="muted">
          {result.total === 0
            ? "Δεν βρέθηκαν ακίνητα που να ταιριάζουν στα κριτήρια."
            : `${result.total} ακίνητα`}
        </p>

        <form action="/properties" method="get" className="searchpanel" style={{ marginBottom: 28 }}>
          {params.q && <input type="hidden" name="q" value={params.q} />}

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 12 }}>Βασικά</legend>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div className="field">
                <label htmlFor="f-listingType">Συναλλαγή</label>
                <select id="f-listingType" name="listingType" className="select" defaultValue={params.listingType ?? ""}>
                  <option value="">Όλες</option>
                  <option value="SALE">Πώληση</option>
                  <option value="RENT">Ενοικίαση</option>
                  <option value="ASSIGNMENT">Ανάθεση</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="f-propertyType">Τύπος</label>
                <select id="f-propertyType" name="propertyType" className="select" defaultValue={params.propertyType ?? ""}>
                  {TYPE_OPTIONS.map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="f-city">Πόλη / Περιοχή</label>
                <input id="f-city" name="city" className="input" defaultValue={params.city ?? ""} />
              </div>

              <div className="field">
                <label htmlFor="f-minPrice">Τιμή από</label>
                <input id="f-minPrice" name="minPrice" className="input" inputMode="numeric" defaultValue={params.minPrice ?? ""} />
              </div>

              <div className="field">
                <label htmlFor="f-maxPrice">Τιμή έως</label>
                <input id="f-maxPrice" name="maxPrice" className="input" inputMode="numeric" defaultValue={params.maxPrice ?? ""} />
              </div>

              <div className="field">
                <label htmlFor="f-minArea">τ.μ. από</label>
                <input id="f-minArea" name="minArea" className="input" inputMode="numeric" defaultValue={params.minArea ?? ""} />
              </div>

              <div className="field">
                <label htmlFor="f-maxArea">τ.μ. έως</label>
                <input id="f-maxArea" name="maxArea" className="input" inputMode="numeric" defaultValue={params.maxArea ?? ""} />
              </div>

              <div className="field">
                <label htmlFor="f-bedrooms">Υπνοδωμάτια (min)</label>
                <input id="f-bedrooms" name="bedrooms" className="input" inputMode="numeric" defaultValue={params.bedrooms ?? ""} />
              </div>

              <div className="field">
                <label htmlFor="f-sort">Ταξινόμηση</label>
                <select id="f-sort" name="sort" className="select" defaultValue={params.sort ?? "newest"}>
                  <option value="newest">Νεότερα</option>
                  <option value="price_asc">Τιμή: αύξουσα</option>
                  <option value="price_desc">Τιμή: φθίνουσα</option>
                  <option value="area_desc">τ.μ.: φθίνουσα</option>
                  <option value="area_asc">τ.μ.: αύξουσα</option>
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
            <legend style={{ fontWeight: 700, marginBottom: 12 }}>Χαρακτηριστικά</legend>
            <div className="row" style={{ gap: 18 }}>
              {FEATURE_FLAGS.map(([key, text]) => (
                <label className="check" key={key} style={{ margin: 0 }}>
                  <input type="checkbox" name={key} value="true" defaultChecked={Boolean(params[key])} />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
            <legend style={{ fontWeight: 700, marginBottom: 12 }}>Επιπλέον</legend>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div className="field">
                <label htmlFor="f-energyClass">Ενεργειακή κλάση</label>
                <select id="f-energyClass" name="energyClass" className="select" defaultValue={params.energyClass ?? ""}>
                  {ENERGY_OPTIONS.map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <div className="row" style={{ marginTop: 8 }}>
            <button type="submit" className="btn btn--primary">Εφαρμογή φίλτρων</button>
            <Link href="/properties" className="btn btn--ghost btn--sm">Καθαρισμός</Link>
          </div>
        </form>

        <PropertyCardGrid properties={result.data} />

        {result.pages > 1 && (
          <nav className="row" style={{ marginTop: 28, justifyContent: "center" }} aria-label="Σελίδες">
            {result.page > 1 && (
              <Link href={pageHref(result.page - 1)} className="btn btn--outline btn--sm">
                Προηγούμενη
              </Link>
            )}
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              Σελίδα {result.page} από {result.pages}
            </span>
            {result.page < result.pages && (
              <Link href={pageHref(result.page + 1)} className="btn btn--outline btn--sm">
                Επόμενη
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
