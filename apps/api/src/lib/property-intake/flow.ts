/** The order in which the assistant asks about a property. */

import { listingProfileFor, profileFor } from "@home88/domain";

export function questionOrder(listingType: string | undefined, propertyType: string | undefined): string[] {
  const keys: string[] = ["listingType", "propertyType"];
  if (!listingType || !propertyType) return keys;
  const profile = profileFor(propertyType);
  const listing = listingProfileFor(listingType);
  keys.push(listing.priceField, "area", "city", "areaName", ...profile.required, ...profile.recommended, ...listing.recommended);
  return [...new Set(keys)];
}
