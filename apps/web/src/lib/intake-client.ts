"use client";

/**
 * Browser helpers shared by the public forms.
 *
 * The idempotency key is made once per mounted form and kept across retries, so
 * a double click or a flaky-network resubmit is recognised by the server as the
 * same submission. Attribution is read once, and is only ever a hint: the server
 * reduces it to a path and a hostname and drops campaign tags unless the visitor
 * allowed measurement.
 */

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ClientAttribution = {
  landingPage: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export function readAttribution(): ClientAttribution {
  const params = new URLSearchParams(window.location.search);
  const pick = (k: string) => params.get(k)?.slice(0, 100) || undefined;
  return {
    landingPage: window.location.pathname,
    referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
  };
}
