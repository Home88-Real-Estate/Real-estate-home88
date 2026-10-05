-- Market data foundation and automated valuation V1. Additive.
--
--  market_data_sources            registry of sources and what each licence allows
--  market_observations            observed prices with full provenance
--  valuation_requests             website valuations, result frozen as produced
--  valuation_request_comparables  the comparables exactly as the engine used them

-- CreateTable
CREATE TABLE "market_data_sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "dataKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accessMethod" TEXT,
    "endpoint" TEXT,
    "updateFrequency" TEXT,
    "licenseType" TEXT,
    "licenseTermsUrl" TEXT,
    "termsVersion" TEXT,
    "permittedUse" TEXT,
    "commercialUse" BOOLEAN,
    "retentionAllowed" BOOLEAN,
    "derivativeAnalytics" BOOLEAN,
    "redistribution" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "usableForValuation" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_observations" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "propertyType" TEXT,
    "listingType" TEXT,
    "region" TEXT,
    "municipality" TEXT,
    "city" TEXT,
    "areaName" TEXT,
    "areaId" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "areaSqm" DECIMAL(10,2),
    "landAreaSqm" DECIMAL(12,2),
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "floor" INTEGER,
    "totalFloors" INTEGER,
    "yearBuilt" INTEGER,
    "yearRenovated" INTEGER,
    "condition" TEXT,
    "features" JSONB,
    "price" DECIMAL(14,2) NOT NULL,
    "pricePerSqm" DECIMAL(12,2),
    "observedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "quality" INTEGER,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "channel" TEXT NOT NULL DEFAULT 'WEBSITE',
    "listingType" TEXT NOT NULL DEFAULT 'SALE',
    "propertyType" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "areaName" TEXT,
    "areaSqm" DECIMAL(10,2) NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "floor" INTEGER,
    "totalFloors" INTEGER,
    "yearBuilt" INTEGER,
    "condition" TEXT,
    "features" JSONB NOT NULL DEFAULT '{}',
    "estimatedMin" DECIMAL(14,2),
    "estimatedValue" DECIMAL(14,2),
    "estimatedMax" DECIMAL(14,2),
    "pricePerSqm" DECIMAL(12,2),
    "pricePerSqmLow" DECIMAL(12,2),
    "pricePerSqmHigh" DECIMAL(12,2),
    "confidence" TEXT,
    "comparableCount" INTEGER NOT NULL DEFAULT 0,
    "strongComparableCount" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "askingCount" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT,
    "explanation" JSONB NOT NULL DEFAULT '{}',
    "engineVersion" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "valuationId" TEXT,
    "assignedAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valuation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_request_comparables" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "observationRef" TEXT NOT NULL,
    "propertyId" TEXT,
    "source" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "areaSqm" DECIMAL(10,2) NOT NULL,
    "pricePerSqm" DECIMAL(12,2) NOT NULL,
    "similarity" DECIMAL(5,3) NOT NULL,
    "recency" DECIMAL(5,3) NOT NULL,
    "weight" DECIMAL(8,5) NOT NULL,
    "ageMonths" DECIMAL(6,1) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "outlier" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_request_comparables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_data_sources_code_key" ON "market_data_sources"("code");

-- CreateIndex
CREATE INDEX "market_observations_observationType_propertyType_observedAt_idx" ON "market_observations"("observationType", "propertyType", "observedAt");

-- CreateIndex
CREATE INDEX "market_observations_city_areaName_idx" ON "market_observations"("city", "areaName");

-- CreateIndex
CREATE INDEX "market_observations_areaId_idx" ON "market_observations"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "market_observations_sourceId_sourceRecordId_key" ON "market_observations"("sourceId", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_requests_reference_key" ON "valuation_requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_requests_idempotencyKey_key" ON "valuation_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "valuation_requests_stage_createdAt_idx" ON "valuation_requests"("stage", "createdAt");

-- CreateIndex
CREATE INDEX "valuation_requests_status_idx" ON "valuation_requests"("status");

-- CreateIndex
CREATE INDEX "valuation_requests_leadId_idx" ON "valuation_requests"("leadId");

-- CreateIndex
CREATE INDEX "valuation_requests_createdAt_idx" ON "valuation_requests"("createdAt");

-- CreateIndex
CREATE INDEX "valuation_request_comparables_requestId_idx" ON "valuation_request_comparables"("requestId");

-- CreateIndex
CREATE INDEX "valuation_request_comparables_propertyId_idx" ON "valuation_request_comparables"("propertyId");

-- AddForeignKey
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "market_data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_requests" ADD CONSTRAINT "valuation_requests_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_requests" ADD CONSTRAINT "valuation_requests_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_requests" ADD CONSTRAINT "valuation_requests_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_requests" ADD CONSTRAINT "valuation_requests_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_request_comparables" ADD CONSTRAINT "valuation_request_comparables_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "valuation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_request_comparables" ADD CONSTRAINT "valuation_request_comparables_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row level security: these tables are reached only through the API (service
-- role); no policies means no direct access for anon/authenticated clients.
ALTER TABLE "market_data_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "market_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "valuation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "valuation_request_comparables" ENABLE ROW LEVEL SECURITY;

-- The automated result is never rewritten. Only the workflow fields may change
-- (stage, assignment, the linked contact/lead/agent valuation).
CREATE OR REPLACE FUNCTION public.h88_guard_valuation_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['stage', 'contactId', 'leadId', 'valuationId', 'assignedAgentId', 'updatedAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['stage', 'contactId', 'leadId', 'valuationId', 'assignedAgentId', 'updatedAt']) THEN
    RAISE EXCEPTION 'the automated valuation result cannot be changed; run a new valuation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_valuation_request_guard BEFORE UPDATE ON "valuation_requests"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_valuation_request();

-- A comparable snapshot is frozen; only the live property link may be cleared
-- when that property is deleted (the snapshot keeps its data).
CREATE OR REPLACE FUNCTION public.h88_guard_valuation_request_comparable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW) - 'propertyId') IS DISTINCT FROM (to_jsonb(OLD) - 'propertyId') THEN
    RAISE EXCEPTION 'valuation comparables are a frozen snapshot';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_valuation_request_comparable_guard BEFORE UPDATE ON "valuation_request_comparables"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_valuation_request_comparable();

REVOKE ALL ON FUNCTION public.h88_guard_valuation_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.h88_guard_valuation_request_comparable() FROM PUBLIC;

-- Source registry. Only HOME88's own data is active. The public sources are
-- registered so their importers have a home, but stay inactive (and their
-- licence flags unset) until their files/feeds are wired and the terms checked.
INSERT INTO "market_data_sources"
  ("id", "code", "name", "sourceType", "dataKinds", "accessMethod", "endpoint", "updateFrequency", "active", "usableForValuation", "notes", "updatedAt")
VALUES
  ('mds_home88', 'HOME88', 'HOME88 CRM (αγγελίες και ολοκληρωμένες συναλλαγές)', 'INTERNAL', ARRAY['ASKING','TRANSACTION'], 'INTERNAL', NULL, 'live', true, true,
   'Δημοσιευμένες αγγελίες πώλησης (ζητούμενη τιμή) και κλεισμένες συναλλαγές πώλησης (συμφωνηθέν τίμημα).', CURRENT_TIMESTAMP),
  ('mds_mama', 'MAMA', 'Μητρώο Αξιών Μεταβιβάσεων Ακινήτων (ΑΑΔΕ)', 'OFFICIAL_PUBLIC', ARRAY['TRANSACTION'], 'FILE', 'https://webapps.gsis.gr/dsae2/trxregistry/', 'yearly', false, false,
   'Ετήσια αρχεία μεταβιβάσεων. Ο εισαγωγέας γράφεται όταν υπάρξει δείγμα αρχείου για επιβεβαίωση των πεδίων.', CURRENT_TIMESTAMP),
  ('mds_bog', 'BANK_OF_GREECE', 'Τράπεζα της Ελλάδος — δείκτες τιμών ακινήτων', 'OFFICIAL_PUBLIC', ARRAY['INDEX'], 'FILE', NULL, 'quarterly', false, false,
   'Δείκτες αγοράς για βαθμονόμηση τάσης· όχι συγκρίσιμα ακίνητα.', CURRENT_TIMESTAMP),
  ('mds_elstat', 'ELSTAT', 'ΕΛΣΤΑΤ / GEODATA — γεωγραφικά όρια και οικισμοί', 'OFFICIAL_PUBLIC', ARRAY['GEOGRAPHY'], 'API', NULL, 'on change', false, false,
   'Κανονική γεωγραφία (περιφέρεια → δήμος → οικισμός).', CURRENT_TIMESTAMP),
  ('mds_objective', 'OBJECTIVE_VALUES', 'Αντικειμενικές αξίες (valuemaps)', 'OFFICIAL_PUBLIC', ARRAY['OBJECTIVE_VALUE'], 'API', NULL, 'on change', false, false,
   'Μόνο ως αναφορά· η αντικειμενική αξία δεν είναι αγοραία αξία.', CURRENT_TIMESTAMP);
