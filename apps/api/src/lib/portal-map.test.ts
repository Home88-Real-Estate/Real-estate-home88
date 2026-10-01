import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaBase, toPortalProperty, type PropertyForPortal } from "./portal-map";

function makeProperty(overrides: Partial<Record<string, unknown>> = {}): PropertyForPortal {
  return {
    id: "p1",
    reference: "H88-000001",
    slug: "h88-000001",
    listingType: "SALE",
    propertyType: "APARTMENT",
    status: "ACTIVE",
    condition: "USED",
    titleEl: "Διαμέρισμα",
    titleEn: null,
    descriptionEl: "Περιγραφή",
    descriptionEn: null,
    price: "150000",
    priceOnRequest: false,
    monthlyRent: null,
    area: "75.5",
    plotArea: null,
    builtArea: null,
    bedrooms: 2,
    bathrooms: 1,
    wc: null,
    floor: null,
    totalFloors: null,
    yearBuilt: null,
    yearRenovated: null,
    heating: "AUTONOMOUS",
    energyClass: "B",
    hasSolar: false,
    parking: true,
    parkingSpaces: 1,
    storage: false,
    balcony: true,
    balconyArea: "12",
    garden: false,
    pool: false,
    furnished: false,
    petsAllowed: true,
    seaView: false,
    newConstruction: false,
    region: "Αττική",
    city: "Αθήνα",
    areaName: "Κολωνάκι",
    neighborhood: null,
    address: null,
    postalCode: null,
    latitude: "37.98",
    longitude: null,
    videoUrl: null,
    virtualTourUrl: null,
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    media: [],
    ...overrides,
  } as unknown as PropertyForPortal;
}

test("mediaBase falls back to the site origin when unset", () => {
  assert.equal(mediaBase({ MEDIA_BASE_URL: "", SITE_URL: "https://home88.gr" }), "https://home88.gr/media");
  assert.equal(mediaBase({ MEDIA_BASE_URL: "https://cdn.home88.gr", SITE_URL: "https://home88.gr" }), "https://cdn.home88.gr");
});

test("only approved or published media leaves the building", () => {
  const property = makeProperty({
    media: [
      { kind: "PHOTO", storageKey: "a.jpg", altEl: "A", sortOrder: 0, isPrimary: true, status: "approved" },
      { kind: "PHOTO", storageKey: "b.jpg", altEl: "B", sortOrder: 1, isPrimary: false, status: "pending_review" },
      { kind: "PHOTO", storageKey: "c.jpg", altEl: "C", sortOrder: 2, isPrimary: false, status: "published" },
      { kind: "PHOTO", storageKey: "d.jpg", altEl: "D", sortOrder: 3, isPrimary: false, status: "rejected" },
    ],
  });

  const view = toPortalProperty(property, "https://cdn.home88.gr");
  assert.deepEqual(view.media.map((item) => item.url), [
    "https://cdn.home88.gr/a.jpg",
    "https://cdn.home88.gr/c.jpg",
  ]);
});

test("absolute media URLs are passed through untouched", () => {
  const property = makeProperty({
    media: [
      { kind: "PHOTO", storageKey: "https://other.example/x.jpg", altEl: null, sortOrder: 0, isPrimary: true, status: "published" },
    ],
  });
  const view = toPortalProperty(property, "https://cdn.home88.gr");
  assert.equal(view.media[0]?.url, "https://other.example/x.jpg");
});

test("Decimal columns are coerced to numbers and nulls preserved", () => {
  const view = toPortalProperty(makeProperty(), "https://cdn.home88.gr");
  assert.equal(view.price, 150000);
  assert.equal(view.area, 75.5);
  assert.equal(view.balconyArea, 12);
  assert.equal(view.latitude, 37.98);
  assert.equal(view.longitude, null);
  assert.equal(view.monthlyRent, null);
  assert.equal(view.updatedAt, "2026-01-02T03:04:05.000Z");
});
