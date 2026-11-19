import type { Metadata } from "next";
import Link from "next/link";
import { can, hasPermission, PERMISSIONS, PROPERTY_CATEGORIES } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS, label, type Paginated } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { PropertyRowActions } from "@/components/PropertyRowActions";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatMoney, personName } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ακίνητα" };

type PropertyRow = {
  id: string;
  reference: string;
  titleEl: string;
  status: string;
  listingType: string;
  propertyType: string;
  price: unknown;
  monthlyRent: unknown;
  area: unknown;
  city: string | null;
  areaName: string | null;
  neighborhood: string | null;
  floor: number | null;
  yearBuilt: number | null;
  createdAt: string;
  updatedAt: string;
  agentId: string | null;
  createdById: string | null;
  agent: { firstName: string; lastName: string } | null;
  owner: { firstName: string; lastName: string } | null;
  _count: { media: number; leads: number };
  coverThumbnailUrl?: string | null;
  tags?: Array<{ code: string; labelEl: string; color: string }>;
};

const PAGE_SIZE = 50;

const STATUS_OPTIONS: Array<[string, string]> = [
  ["", "Όλες οι καταστάσεις"],
  ...Object.keys(PROPERTY_STATUS_LABELS).map((value): [string, string] => [
    value,
    label(PROPERTY_STATUS_LABELS, value, "el"),
  ]),
];

const GROUP_LABEL: Record<string, string> = {
  CURRENT: "Χωρίς τα αρχειοθετημένα",
  PUBLIC: "Στην αγορά",
  DELETED: "Διαγραμμένα",
};

/** The folders offered above the table; the bin is one of them. */
const GROUPS = ["CURRENT", "PUBLIC", "DELETED"];

/** A folder link that keeps every other filter the user has picked. */
function groupHref(group: string, params: Record<string, string>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value || key === "status" || key === "statusGroup") continue;
    next.set(key, value);
  }
  next.set("statusGroup", group);
  const qs = next.toString();
  return qs ? `/properties?${qs}` : "/properties";
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("AGENT");
  const actor = { id: user.id, role: user.role };
  const sp = await searchParams;

  const q = first(sp.q);
  const status = first(sp.status);
  const listingType = first(sp.listingType);
  const propertyType = first(sp.propertyType);
  const category = first(sp.category);
  const city = first(sp.city);
  const areaName = first(sp.areaName);
  const neighborhood = first(sp.neighborhood);
  const minPrice = first(sp.minPrice);
  const maxPrice = first(sp.maxPrice);
  const minArea = first(sp.minArea);
  const maxArea = first(sp.maxArea);
  const bedrooms = first(sp.bedrooms);
  const bathrooms = first(sp.bathrooms);
  const minFloor = first(sp.minFloor);
  const maxFloor = first(sp.maxFloor);
  const minYearBuilt = first(sp.minYearBuilt);
  const maxYearBuilt = first(sp.maxYearBuilt);
  const heating = first(sp.heating);
  const energyClass = first(sp.energyClass);
  const parking = first(sp.parking);
  const pool = first(sp.pool);
  const garden = first(sp.garden);
  const seaView = first(sp.seaView);
  const furnished = first(sp.furnished);
  const petsAllowed = first(sp.petsAllowed);
  const newConstruction = first(sp.newConstruction);
  const priceOnRequest = first(sp.priceOnRequest);
  const publishedOnWebsite = first(sp.publishedOnWebsite);
  const featured = first(sp.featured);
  const statusGroup = first(sp.statusGroup);
  const mine = first(sp.mine) === "1" ? "1" : "";
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const query = {
    q, status, listingType, propertyType, category, city, areaName, neighborhood,
    minPrice, maxPrice, minArea, maxArea, bedrooms, bathrooms, minFloor, maxFloor,
    minYearBuilt, maxYearBuilt, heating, energyClass, parking, pool, garden, seaView,
    furnished, petsAllowed, newConstruction, priceOnRequest, publishedOnWebsite, featured,
    statusGroup, mine, page, limit: PAGE_SIZE,
  };

  const result = await apiFetch<Paginated<PropertyRow>>("/api/properties", { query });

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value && key !== "page" && key !== "limit") params[key] = value;
  }
  const filtered = Object.keys(params).length > 0;

  return (
    <>
      <div className="page-head">
        <div>
<h1>{statusGroup === "DELETED" ? "Διαγραμμένα" : "Ακίνητα"}</h1>
          <p className="muted">Γρήγορη αναζήτηση και σύνθετα φίλτρα για όλο το χαρτοφυλάκιο.</p>
          {result.ok && (
            <p className="muted">
              Αποτελέσματα <strong>{result.data.pagination.total}</strong>
            </p>
          )}
        </div>
        <Link href="/properties/new" className="btn btn--primary">
          + Νέο ακίνητο
        </Link>
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/properties`}>
        <div className="field">
          <label htmlFor="q">Γρήγορη αναζήτηση</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Κωδικός, τίτλος, διεύθυνση ή περιοχή" />
        </div>
        <div className="field">
          <label htmlFor="listingType">Είδος αγγελίας</label>
          <select id="listingType" name="listingType" className="select" defaultValue={listingType}>
            <option value="">Όλα</option>
            {Object.keys(LISTING_TYPE_LABELS).map((value) => (
              <option key={value} value={value}>{label(LISTING_TYPE_LABELS, value, "el")}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="propertyType">Τύπος ακινήτου</label>
          <select id="propertyType" name="propertyType" className="select" defaultValue={propertyType}>
            <option value="">Όλοι οι τύποι</option>
            {Object.keys(PROPERTY_TYPE_LABELS).map((value) => (
              <option key={value} value={value}>{label(PROPERTY_TYPE_LABELS, value, "el")}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="city">Πόλη / Δήμος</label>
          <input id="city" name="city" className="input" defaultValue={city} />
        </div>
        <div className="field">
          <label htmlFor="status">Κατάσταση</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            {STATUS_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </div>
        <details className="filters__advanced" style={{ gridColumn: "1 / -1" }}>
          <summary>Σύνθετη αναζήτηση</summary>
          {statusGroup && <input type="hidden" name="statusGroup" value={statusGroup} />}
          <div className="formgrid" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="category">Κατηγορία</label>
              <select id="category" name="category" className="select" defaultValue={category}>
                <option value="">Όλες</option>
                {PROPERTY_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="areaName">Περιοχή</label>
              <input id="areaName" name="areaName" className="input" defaultValue={areaName} />
            </div>
            <div className="field">
              <label htmlFor="neighborhood">Γειτονιά</label>
              <input id="neighborhood" name="neighborhood" className="input" defaultValue={neighborhood} />
            </div>
            <div className="field">
              <label htmlFor="minPrice">Τιμή από (€)</label>
              <input id="minPrice" name="minPrice" className="input" type="number" min="0" defaultValue={minPrice} />
            </div>
            <div className="field">
              <label htmlFor="maxPrice">Τιμή έως (€)</label>
              <input id="maxPrice" name="maxPrice" className="input" type="number" min="0" defaultValue={maxPrice} />
            </div>
            <div className="field">
              <label htmlFor="minArea">Εμβαδόν από (τ.μ.)</label>
              <input id="minArea" name="minArea" className="input" type="number" min="0" defaultValue={minArea} />
            </div>
            <div className="field">
              <label htmlFor="maxArea">Εμβαδόν έως (τ.μ.)</label>
              <input id="maxArea" name="maxArea" className="input" type="number" min="0" defaultValue={maxArea} />
            </div>
            <div className="field">
              <label htmlFor="bedrooms">Υπνοδωμάτια από</label>
              <input id="bedrooms" name="bedrooms" className="input" type="number" min="0" defaultValue={bedrooms} />
            </div>
            <div className="field">
              <label htmlFor="bathrooms">Μπάνια από</label>
              <input id="bathrooms" name="bathrooms" className="input" type="number" min="0" defaultValue={bathrooms} />
            </div>
            <div className="field">
              <label htmlFor="minFloor">Όροφος από</label>
              <input id="minFloor" name="minFloor" className="input" type="number" min="-10" defaultValue={minFloor} />
            </div>
            <div className="field">
              <label htmlFor="maxFloor">Όροφος έως</label>
              <input id="maxFloor" name="maxFloor" className="input" type="number" min="-10" defaultValue={maxFloor} />
            </div>
            <div className="field">
              <label htmlFor="minYearBuilt">Έτος κατασκευής από</label>
              <input id="minYearBuilt" name="minYearBuilt" className="input" type="number" min="1800" max="2100" defaultValue={minYearBuilt} />
            </div>
            <div className="field">
              <label htmlFor="maxYearBuilt">Έτος κατασκευής έως</label>
              <input id="maxYearBuilt" name="maxYearBuilt" className="input" type="number" min="1800" max="2100" defaultValue={maxYearBuilt} />
            </div>
            <div className="field">
              <label htmlFor="heating">Θέρμανση</label>
              <select id="heating" name="heating" className="select" defaultValue={heating}>
                <option value="">Όλες</option>
                {["CENTRAL", "INDIVIDUAL", "UNDERFLOOR", "HEAT_PUMP", "GAS", "NONE", "NOT_AVAILABLE"].map((value) => (
                  <option key={value} value={value}>{value === "NOT_AVAILABLE" ? "Δεν έχει δηλωθεί" : value}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="energyClass">Ενεργειακή κλάση</label>
              <select id="energyClass" name="energyClass" className="select" defaultValue={energyClass}>
                <option value="">Όλες</option>
                {["A_PLUS", "A", "B", "C", "D", "E", "F", "G", "NOT_AVAILABLE"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Χαρακτηριστικά</label>
              <div className="checkgrid">
                {[
                  ["parking", "Parking", parking],
                  ["pool", "Πισίνα", pool],
                  ["garden", "Κήπος", garden],
                  ["seaView", "Θέα θάλασσα", seaView],
                  ["furnished", "Επιπλωμένο", furnished],
                  ["petsAllowed", "Επιτρέπονται κατοικίδια", petsAllowed],
                  ["newConstruction", "Νεόδμητο", newConstruction],
                  ["priceOnRequest", "Τιμή κατόπιν επικοινωνίας", priceOnRequest],
                  ["publishedOnWebsite", "Δημοσιευμένο στον ιστότοπο", publishedOnWebsite],
                  ["featured", "Προβεβλημένο", featured],
                ].map(([name, text, value]) => (
                  <label key={String(name)} className="check">
                    <input type="checkbox" name={String(name)} value="true" defaultChecked={value === "true"} />
                    {String(text)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>
        {statusGroup && <input type="hidden" name="statusGroup" value={statusGroup} />}
        <label className="check filters__check">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine === "1"} />
          Μόνο τα δικά μου
        </label>
        <button type="submit" className="btn btn--outline">Αναζήτηση</button>
        {filtered && <Link href="/properties" className="btn btn--ghost">Καθαρισμός</Link>}
      </form>

      <p className="filter-chip-row">
        {GROUPS.map((group) =>
          statusGroup === group ? (
            <span key={group} className="filter-chip">
              {GROUP_LABEL[group]}
            </span>
          ) : (
            <Link key={group} href={groupHref(group, params)} className="filter-chip">
              {GROUP_LABEL[group]}
            </Link>
          ),
        )}
      </p>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        filtered ? (
          <EmptyState title="Κανένα ακίνητο δεν ταιριάζει" text="Αλλάξτε ή καθαρίστε τα φίλτρα." />
        ) : (
          <EmptyState
            title="Δεν υπάρχουν ακόμη ακίνητα"
            text="Καταχωρίστε το πρώτο ακίνητο για να ξεκινήσει το χαρτοφυλάκιο."
            action={{ href: "/properties/new", label: "+ Νέο ακίνητο" }}
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th className="thumb-col">Εικόνα</th>
                  <th>Ημερ/νία</th>
                  <th className="num">Τιμή</th>
                  <th className="num">Εμβαδόν</th>
<th className="num">Όροφος</th>
                  <th>Περιοχή</th>
                  <th>Υποκατηγορία</th>
                  <th className="num">Έτος Κατασκευής</th>
                  <th>Υπεύθυνος</th>
                  <th>Κατάσταση</th>
                  <th>Ιδιοκτήτης</th>
                  <th>Ενέργειες</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => {
                  const inBin = row.status === "DELETED";
                  const scope = { agentId: row.agentId, createdById: row.createdById };
                  return (
                    <tr key={row.id}>
                      <td className="mono">
                        <Link href={`/properties/${row.id}`}>{row.reference}</Link>
                        {row.tags && row.tags.length > 0 && (
                          <ul className="taglist-inline" aria-label="Ετικέτες">
                            {row.tags.map((t) => (
                              <li key={t.code} className={`tagchip tagchip--${t.color}`}>
                                {t.labelEl}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="thumb-col">
                        <Link href={`/properties/${row.id}`} tabIndex={-1} aria-hidden="true">
                          {row.coverThumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already a small variant
                            <img src={row.coverThumbnailUrl} alt="" className="thumb" loading="lazy" width={160} height={120} />
                          ) : (
                            <span className="thumb thumb--empty" />
                          )}
                        </Link>
                      </td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td className="num">{formatMoney(row.monthlyRent ?? row.price)}</td>
                      <td className="num">{formatArea(row.area)}</td>
                      <td className="num">{row.floor ?? "-"}</td>
                      <td>{row.areaName ?? row.neighborhood ?? row.city ?? "-"}</td>
                      <td>{label(PROPERTY_TYPE_LABELS, row.propertyType, "el")}</td>
                      <td className="num">{row.yearBuilt ?? "-"}</td>
                      <td>{row.agent ? personName(row.agent.firstName, row.agent.lastName) : "-"}</td>
                      <td>
                        <StatusBadge value={row.status} kind="property" />
                      </td>
                      <td>{row.owner ? personName(row.owner.firstName, row.owner.lastName) : "-"}</td>
                      <td>
                        <PropertyRowActions
                          id={row.id}
                          canDelete={
                            !inBin && can(actor, PERMISSIONS.PROPERTY_DELETE, scope)
                          }
                          canRestore={
                            inBin && can(actor, PERMISSIONS.PROPERTY_RESTORE, scope)
                          }
                          canPermanentlyDelete={
                            inBin && hasPermission(actor, PERMISSIONS.PROPERTY_DELETE_PERMANENT)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={result.data.pagination.page}
            pages={result.data.pagination.pages}
            total={result.data.pagination.total}
            basePath="/properties"
            params={params}
          />
        </>
      )}
    </>
  );
}
