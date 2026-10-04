/**
 * Source attribution, kept to what is useful and permitted.
 *
 * We keep the landing path (no query string, no host), the referring hostname
 * (never the full referrer URL), a coarse channel, and campaign tags only when
 * the visitor allowed measurement. Every value is length- and charset-bounded
 * because it arrives from a browser and ends up in the CRM.
 */

export type RawAttribution = {
  landingPage?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

export type Attribution = {
  landingPage: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  sourceChannel: string | null;
};

export const SOURCE_CHANNELS = ["GOOGLE", "INSTAGRAM", "FACEBOOK", "TIKTOK", "PORTAL", "EMAIL", "REFERRAL", "OTHER"] as const;

const CHANNEL_BY_HOST: Array<[RegExp, (typeof SOURCE_CHANNELS)[number]]> = [
  [/(^|\.)google\./, "GOOGLE"],
  [/(^|\.)instagram\.com$/, "INSTAGRAM"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "FACEBOOK"],
  [/(^|\.)tiktok\.com$/, "TIKTOK"],
  [/(^|\.)(spitogatos\.gr|xe\.gr)$/, "PORTAL"],
];

const CHANNEL_BY_UTM: Record<string, (typeof SOURCE_CHANNELS)[number]> = {
  google: "GOOGLE",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  fb: "FACEBOOK",
  tiktok: "TIKTOK",
  spitogatos: "PORTAL",
  xe: "PORTAL",
  email: "EMAIL",
  newsletter: "EMAIL",
};

function tag(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").trim();
  return /^[\p{L}\p{N}_\-. +]{1,80}$/u.test(cleaned) ? cleaned : null;
}

export function sanitiseLandingPage(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split(/[?#]/)[0]!;
  return /^[A-Za-z0-9/_\-.%]{1,200}$/.test(path) ? path : null;
}

export function refererHostname(raw: string | null | undefined, ownHosts: readonly string[] = []): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || ownHosts.map((h) => h.toLowerCase().replace(/^www\./, "")).includes(host)) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

export function sanitiseAttribution(
  raw: RawAttribution | null | undefined,
  options: { allowCampaign: boolean; ownHosts?: readonly string[] },
): Attribution {
  const referrerHost = refererHostname(raw?.referrer, options.ownHosts);
  const utmSource = options.allowCampaign ? tag(raw?.utmSource) : null;
  const utmMedium = options.allowCampaign ? tag(raw?.utmMedium) : null;
  const utmCampaign = options.allowCampaign ? tag(raw?.utmCampaign) : null;

  let sourceChannel: string | null = null;
  if (utmSource) sourceChannel = CHANNEL_BY_UTM[utmSource.toLowerCase()] ?? "OTHER";
  else if (referrerHost) sourceChannel = CHANNEL_BY_HOST.find(([re]) => re.test(referrerHost))?.[1] ?? "REFERRAL";

  return { landingPage: sanitiseLandingPage(raw?.landingPage), referrerHost, utmSource, utmMedium, utmCampaign, sourceChannel };
}
