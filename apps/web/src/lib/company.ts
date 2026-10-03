/**
 * Public company details for the website, from Settings → Εταιρία / Απόρρητο
 * in the CRM, with the original environment values as a fallback.
 *
 * Nothing is invented: a value that is not configured is null and the page
 * leaves it out. Placeholder addresses (example.com) are treated as missing,
 * so a fresh deployment never shows a fake contact to visitors.
 */

import { unstable_cache } from "next/cache";
import { COMPANY } from "./config";
import { safeQuery } from "./db";

export type CompanyInfo = {
  /** Shown name: office name, else the public legal name, else "HOME88". */
  name: string;
  legalName: string;
  phone: string | null;
  phones: string[];
  email: string | null;
  address: string | null;
  hours: string | null;
  profile: string | null;
  socials: Array<{ platform: string; url: string }>;
  privacyEmail: string | null;
  dmcaEmail: string | null;
};

export type CompanyRows = {
  settings: Partial<Record<string, string | null>> | null;
  privacy: { privacyEmail: string | null; dmcaEmail: string | null } | null;
  socials: Array<{ platform: string; url: string }>;
  profileEl: string | null;
};

const SOCIAL_ORDER = ["FACEBOOK", "INSTAGRAM", "YOUTUBE", "LINKEDIN", "X", "PINTEREST", "TIKTOK"];

export function isPlaceholderEmail(value: string | null | undefined): boolean {
  return !value || /@example\.(com|org|net)$/i.test(value.trim());
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const realEmail = (v: string | null | undefined) => (isPlaceholderEmail(v) ? null : clean(v));

/** Pure merge of stored settings over the environment fallback (unit-tested). */
export function mergeCompany(rows: CompanyRows, env: typeof COMPANY = COMPANY): CompanyInfo {
  const s = rows.settings ?? {};
  const legalName = clean(s.legalName) ?? clean(env.legalName) ?? "HOME88";
  const phones = [clean(s.phone1), clean(s.phone2), clean(s.mobile)].filter((p): p is string => Boolean(p));
  const addressParts = [clean(s.addressEl), [clean(s.postalCode), clean(s.city)].filter(Boolean).join(" ") || null].filter(Boolean);
  return {
    name: clean(s.officeName) ?? legalName,
    legalName,
    phone: phones[0] ?? clean(env.phone),
    phones: phones.length > 0 ? phones : [clean(env.phone)].filter((p): p is string => Boolean(p)),
    email: realEmail(s.email) ?? realEmail(env.contactEmail),
    address: addressParts.length > 0 ? addressParts.join(", ") : clean(env.postalAddress),
    hours: clean(s.hoursEl) ?? clean(env.hours),
    profile: clean(rows.profileEl),
    socials: [...rows.socials]
      .filter((x) => SOCIAL_ORDER.includes(x.platform) && /^https:\/\//i.test(x.url))
      .sort((a, b) => SOCIAL_ORDER.indexOf(a.platform) - SOCIAL_ORDER.indexOf(b.platform)),
    privacyEmail: realEmail(rows.privacy?.privacyEmail) ?? realEmail(env.privacyEmail),
    dmcaEmail: realEmail(rows.privacy?.dmcaEmail) ?? realEmail(env.dmcaEmail),
  };
}

const loadRows = unstable_cache(
  async (): Promise<CompanyRows> =>
    safeQuery(
      "company settings",
      async (db) => {
        const [settings, privacy, socials, profile] = await Promise.all([
          db.companySettings.findUnique({ where: { id: "default" } }),
          db.privacySettings.findUnique({ where: { id: "default" }, select: { privacyEmail: true, dmcaEmail: true } }),
          db.companySocialLink.findMany({ select: { platform: true, url: true } }),
          db.companyProfile.findUnique({ where: { locale: "el" }, select: { body: true } }),
        ]);
        return {
          settings: settings as unknown as CompanyRows["settings"],
          privacy,
          socials,
          profileEl: profile?.body ?? null,
        };
      },
      { settings: null, privacy: null, socials: [], profileEl: null },
    ),
  ["home88-company-settings"],
  // Changes made in the CRM appear on the site within two minutes.
  { revalidate: 120, tags: ["company-settings"] },
);

export async function getCompanyInfo(): Promise<CompanyInfo> {
  return mergeCompany(await loadRows());
}
