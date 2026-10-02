/**
 * Shared result and pagination shapes. Kept dependency-free so both the
 * website and the CRM can import them without pulling in Prisma.
 */

export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export type AppError = {
  code: string;
  message: string;
  /** Field-level messages for form rendering. Never contains raw SQL. */
  fields?: Record<string, string[]>;
};

export type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

export const LOCALES = ["el", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "el";

/** Maps the internal enum to a Greek/English label for display. */
export type Localised = { el: string; en: string };

export const LISTING_TYPE_LABELS: Record<string, Localised> = {
  SALE: { el: "Πώληση", en: "For sale" },
  RENT: { el: "Ενοικίαση", en: "For rent" },
  ASSIGNMENT: { el: "Ανάθεση", en: "Assignment" },
};

export const PROPERTY_TYPE_LABELS: Record<string, Localised> = {
  APARTMENT: { el: "Διαμέρισμα", en: "Apartment" },
  MAISONETTE: { el: "Μεζονέτα", en: "Maisonette" },
  HOUSE: { el: "Μονοκατοικία", en: "House" },
  VILLA: { el: "Βίλα", en: "Villa" },
  STUDIO: { el: "Στούντιο", en: "Studio" },
  OFFICE: { el: "Γραφείο", en: "Office" },
  SHOP: { el: "Κατάστημα", en: "Shop" },
  WAREHOUSE: { el: "Αποθήκη", en: "Warehouse" },
  BUILDING: { el: "Κτίριο", en: "Building" },
  HOTEL: { el: "Ξενοδοχείο", en: "Hotel" },
  LAND: { el: "Γη", en: "Land" },
  PLOT: { el: "Οικόπεδο", en: "Plot" },
  PARKING: { el: "Parking", en: "Parking" },
  INDUSTRIAL: { el: "Βιομηχανικό", en: "Industrial" },
  OTHER: { el: "Άλλο", en: "Other" },
};

export const PROPERTY_STATUS_LABELS: Record<string, Localised> = {
  DRAFT: { el: "Πρόχειρο", en: "Draft" },
  ACTIVE: { el: "Ενεργό", en: "Active" },
  UNDER_OFFER: { el: "Υπό προσφορά", en: "Under offer" },
  RESERVED: { el: "Κρατημένο", en: "Reserved" },
  SOLD: { el: "Πωλήθηκε", en: "Sold" },
  RENTED: { el: "Νοικιάστηκε", en: "Rented" },
  INACTIVE: { el: "Αποσυρμένο", en: "Withdrawn" },
  ARCHIVED: { el: "Αρχειοθετημένο", en: "Archived" },
};

export const LEAD_STATUS_LABELS: Record<string, Localised> = {
  NEW: { el: "Νέο", en: "New" },
  CONTACTED: { el: "Επικοινωνία", en: "Contacted" },
  QUALIFIED: { el: "Εξακριβωμένο", en: "Qualified" },
  VIEWING: { el: "Επίσκεψη", en: "Viewing" },
  OFFER: { el: "Προσφορά", en: "Offer" },
  WON: { el: "Κέρδος", en: "Won" },
  LOST: { el: "Χάθηκε", en: "Lost" },
  NOT_INTERESTED: { el: "Χωρίς ενδιαφέρον", en: "Not interested" },
};

export const LEAD_SOURCE_LABELS: Record<string, Localised> = {
  WEBSITE: { el: "Ιστοσελίδα", en: "Website" },
  PROPERTY_ENQUIRY: { el: "Ερώτηση ακινήτου", en: "Property enquiry" },
  PHONE: { el: "Τηλέφωνο", en: "Phone" },
  WHATSAPP: { el: "WhatsApp", en: "WhatsApp" },
  EMAIL: { el: "Email", en: "Email" },
  SPITOGATOS: { el: "Spitogatos", en: "Spitogatos" },
  XE_GR: { el: "XE.gr", en: "XE.gr" },
  PORTAL_OTHER: { el: "Άλλο portal", en: "Other portal" },
  WALK_IN: { el: "Επίσκεψη γραφείου", en: "Walk-in" },
  REFERRAL: { el: "Σύσταση", en: "Referral" },
  SOCIAL: { el: "Social", en: "Social" },
  IMPORT: { el: "Εισαγωγή", en: "Import" },
  OTHER: { el: "Άλλο", en: "Other" },
};

export const USER_ROLE_LABELS: Record<string, Localised> = {
  SUPER_ADMIN: { el: "Διαχειριστής συστήματος", en: "Super admin" },
  ADMIN: { el: "Διαχειριστής", en: "Admin" },
  MANAGER: { el: "Υπεύθυνος", en: "Manager" },
  AGENT: { el: "Μεσίτης", en: "Agent" },
  MARKETING: { el: "Marketing", en: "Marketing" },
  VIEWER: { el: "Παρατηρητής", en: "Viewer" },
};

export const USER_STATUS_LABELS: Record<string, Localised> = {
  ACTIVE: { el: "Ενεργός", en: "Active" },
  SUSPENDED: { el: "Σε αναστολή", en: "Suspended" },
  INVITED: { el: "Πρόσκληση", en: "Invited" },
};

export function label(
  map: Record<string, Localised>,
  key: string | null | undefined,
  locale: Locale,
): string {
  if (!key) return "—";
  const entry = map[key];
  if (!entry) return key;
  return entry[locale];
}

/**
 * Public-facing property shape. The website must never receive owner contact
 * details, commission rates or internal notes, so this is an explicit
 * allow-list rather than a Prisma row with fields deleted.
 */
export type PublicPropertySummary = {
  reference: string;
  slug: string;
  listingType: string;
  propertyType: string;
  status: string;
  title: string;
  city: string | null;
  areaName: string | null;
  neighborhood: string | null;
  price: number | null;
  priceOnRequest: boolean;
  area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: boolean;
  storage: boolean;
  energyClass: string;
  isNew: boolean;
  isFeatured: boolean;
  primaryImage: string | null;
  imageCount: number;
};

export type PublicPropertyDetail = PublicPropertySummary & {
  titleSecondary: string | null;
  description: string;
  descriptionSecondary: string | null;
  condition: string;
  heating: string;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  yearRenovated: number | null;
  parking: boolean;
  storage: boolean;
  balcony: boolean;
  garden: boolean;
  pool: boolean;
  furnished: boolean;
  petsAllowed: boolean;
  seaView: boolean;
  hasSolar: boolean;
  plotArea: number | null;
  latitude: number | null;
  longitude: number | null;
  videoUrl: string | null;
  virtualTourUrl: string | null;
  images: Array<{ url: string; alt: string; kind: string }>;
  agent: {
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
};

export function formatPrice(
  price: number | null,
  priceOnRequest: boolean,
  listingType: string,
  locale: Locale,
): string {
  if (priceOnRequest || price == null) {
    return locale === "el" ? "Τιμή κατόπιν επικοινωνίας" : "Price on request";
  }
  const formatted = new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
  return listingType === "RENT" ? `${formatted}/${locale === "el" ? "μήνα" : "mo"}` : formatted;
}

export function formatArea(area: number | null, locale: Locale): string | null {
  if (area == null) return null;
  return `${new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(area)} m²`;
}
