/**
 * Shared by buyer requests (Ζητήσεις) and automations: the property fields
 * matching reads, and the conversion of database rows into the plain shapes
 * the scoring rules in @home88/domain take.
 */

import type { Prisma } from "@home88/database";
import { CORE_FLAG_KEYS, type MatchProperty, type MatchRequest } from "@home88/domain";

export const PROPERTY_MATCH_SELECT = {
  id: true,
  reference: true,
  titleEl: true,
  listingType: true,
  propertyType: true,
  status: true,
  price: true,
  monthlyRent: true,
  priceOnRequest: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  floor: true,
  yearBuilt: true,
  city: true,
  areaName: true,
  neighborhood: true,
  region: true,
  details: true,
  parking: true,
  storage: true,
  balcony: true,
  garden: true,
  pool: true,
  furnished: true,
  petsAllowed: true,
  seaView: true,
  hasSolar: true,
  newConstruction: true,
} satisfies Prisma.PropertySelect;

export type PropertyRow = Prisma.PropertyGetPayload<{ select: typeof PROPERTY_MATCH_SELECT }>;
export type RequestRow = Prisma.BuyerRequestGetPayload<object>;

export const n = (v: unknown) => (v == null ? null : Number(v));

export function toMatchProperty(p: PropertyRow): MatchProperty {
  const row = p as unknown as Record<string, unknown>;
  const flags: Record<string, unknown> = { ...((p.details as Record<string, unknown> | null) ?? {}) };
  for (const key of CORE_FLAG_KEYS) flags[key] = row[key];
  return {
    listingType: p.listingType,
    propertyType: p.propertyType,
    status: p.status,
    price: n(p.price),
    monthlyRent: n(p.monthlyRent),
    priceOnRequest: p.priceOnRequest,
    area: n(p.area),
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    floor: p.floor,
    yearBuilt: p.yearBuilt,
    city: p.city,
    areaName: p.areaName,
    neighborhood: p.neighborhood,
    region: p.region,
    flags,
  };
}

export function toMatchRequest(r: RequestRow): MatchRequest {
  return {
    listingType: r.listingType,
    propertyTypes: r.propertyTypes,
    areas: r.areas,
    minPrice: n(r.minPrice),
    maxPrice: n(r.maxPrice),
    minArea: n(r.minArea),
    maxArea: n(r.maxArea),
    minBedrooms: r.minBedrooms,
    minBathrooms: r.minBathrooms,
    minFloor: r.minFloor,
    minYearBuilt: r.minYearBuilt,
    features: r.features,
  };
}
