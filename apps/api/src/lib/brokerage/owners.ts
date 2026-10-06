import type { OwnerFact } from "@home88/domain";

import type { Db } from "./types";

/**
 * The owners of a property for validation: the PropertyOwner rows when there are
 * any, otherwise the single contact in Property.ownerId (the pre-existing
 * field), as an owner with no stated share who is not yet marked as signing.
 */
export async function loadOwnerFacts(db: Db, propertyId: string): Promise<OwnerFact[]> {
  const rows = await db.propertyOwner.findMany({ where: { propertyId }, orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }] });
  if (rows.length > 0) {
    return rows.map((r) => ({
      contactId: r.contactId,
      capacity: r.capacity,
      ownershipPercentage: r.ownershipPercentage == null ? null : Number(r.ownershipPercentage),
      isSignatory: r.isSignatory,
      representativeCapacity: r.representativeCapacity,
      hasAuthority: r.authorityDocumentId != null || (r.authorityReference != null && r.authorityReference.trim() !== ""),
      validFrom: r.validFrom,
      validTo: r.validTo,
    }));
  }
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } });
  return property?.ownerId ? [{ contactId: property.ownerId, capacity: "OWNER", ownershipPercentage: null, isSignatory: false }] : [];
}
