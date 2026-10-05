/**
 * Website glue for the valuation engine. The numbers are computed and stored
 * on the server (`@home88/valuation/service`); the browser only sends the
 * property description and receives the public view.
 */

import { profileFor } from "@home88/domain";
import type { ValuationInputDto } from "@home88/validation";
import type { ConditionCode, FeatureKey, Subject } from "@home88/valuation";

const FEATURES: FeatureKey[] = ["parking", "storage", "balcony", "garden", "pool", "seaView", "elevator"];

/** Keeps only what applies to this property type (an apartment's floor, never a plot's). */
export function subjectFromInput(input: ValuationInputDto): Subject {
  const profile = profileFor(input.propertyType);
  const has = (field: string) => profile.core.includes(field);
  const features: Partial<Record<FeatureKey, boolean>> = {};
  for (const key of FEATURES) {
    if (profile.features.includes(key) && input[key] !== undefined) features[key] = Boolean(input[key]);
  }
  return {
    propertyType: input.propertyType,
    areaSqm: input.area,
    location: { region: input.region || null, city: input.city || null, area: input.areaName || null },
    condition: profile.conditions && input.condition ? (input.condition as ConditionCode) : null,
    yearBuilt: has("yearBuilt") ? (input.yearBuilt ?? null) : null,
    floor: has("floor") ? (input.floor ?? null) : null,
    bedrooms: has("bedrooms") ? (input.bedrooms ?? null) : null,
    bathrooms: has("bathrooms") ? (input.bathrooms ?? null) : null,
    features,
  };
}
