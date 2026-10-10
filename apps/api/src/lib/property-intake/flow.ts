/** The order in which the assistant asks about a property. */

import { listingProfileFor, profileFor } from "@home88/domain";

/** After the essentials, at most this many property-specific questions are asked before the summary. */
export const MAX_DETAIL_QUESTIONS = 4;

export function questionOrder(listingType: string | undefined, propertyType: string | undefined): string[] {
  const keys: string[] = ["listingType", "propertyType"];
  if (!listingType || !propertyType) return keys;
  const profile = profileFor(propertyType);
  const listing = listingProfileFor(listingType);
  // The essentials, then only a few type-specific details: the assistant should not interrogate the agent about
  // every optional field. Everything else can still be said at any time or added by touch.
  keys.push(listing.priceField, "areaName", "area");
  const essentials = new Set(keys);
  const specific = [...new Set([...profile.required, ...profile.recommended, ...listing.recommended])].filter((k) => !essentials.has(k) && k !== "city");
  return [...keys, ...specific.slice(0, MAX_DETAIL_QUESTIONS)];
}
