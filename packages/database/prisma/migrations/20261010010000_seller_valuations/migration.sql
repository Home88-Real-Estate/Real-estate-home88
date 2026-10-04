-- Owner (seller) pipeline and comparative market valuations.
-- Additive: new tables only.

-- CreateTable
CREATE TABLE "seller_leads" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "listingType" TEXT NOT NULL,
    "contactId" TEXT,
    "ownerName" TEXT NOT NULL,
    "propertyId" TEXT,
    "propertyType" TEXT,
    "city" TEXT,
    "areaName" TEXT,
    "address" TEXT,
    "area" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "floor" INTEGER,
    "yearBuilt" INTEGER,
    "condition" TEXT,
    "askingPrice" DECIMAL(14,2),
    "motivation" TEXT,
    "timeframe" TEXT,
    "source" TEXT,
    "agentId" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "listedAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_lead_events" (
    "id" TEXT NOT NULL,
    "sellerLeadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuations" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "listingType" TEXT NOT NULL,
    "propertyId" TEXT,
    "sellerLeadId" TEXT,
    "propertyType" TEXT NOT NULL,
    "city" TEXT,
    "areaName" TEXT,
    "area" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "floor" INTEGER,
    "yearBuilt" INTEGER,
    "condition" TEXT,
    "compCount" INTEGER NOT NULL DEFAULT 0,
    "medianPerSqm" DECIMAL(12,2),
    "lowPerSqm" DECIMAL(12,2),
    "highPerSqm" DECIMAL(12,2),
    "estimate" DECIMAL(14,2),
    "low" DECIMAL(14,2),
    "high" DECIMAL(14,2),
    "confidence" TEXT,
    "recommendedPrice" DECIMAL(14,2),
    "rationale" TEXT,
    "agentId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_comparables" (
    "id" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "propertyId" TEXT,
    "label" TEXT NOT NULL,
    "source" TEXT,
    "city" TEXT,
    "areaName" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "area" DECIMAL(10,2) NOT NULL,
    "bedrooms" INTEGER,
    "floor" INTEGER,
    "yearBuilt" INTEGER,
    "condition" TEXT,
    "observedAt" TIMESTAMP(3),
    "similarity" INTEGER,
    "adjustmentPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_comparables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_leads_reference_key" ON "seller_leads"("reference");

-- CreateIndex
CREATE INDEX "seller_leads_stage_idx" ON "seller_leads"("stage");

-- CreateIndex
CREATE INDEX "seller_leads_agentId_stage_idx" ON "seller_leads"("agentId", "stage");

-- CreateIndex
CREATE INDEX "seller_leads_contactId_idx" ON "seller_leads"("contactId");

-- CreateIndex
CREATE INDEX "seller_leads_propertyId_idx" ON "seller_leads"("propertyId");

-- CreateIndex
CREATE INDEX "seller_leads_nextFollowUpAt_idx" ON "seller_leads"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "seller_lead_events_sellerLeadId_createdAt_idx" ON "seller_lead_events"("sellerLeadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "valuations_reference_key" ON "valuations"("reference");

-- CreateIndex
CREATE INDEX "valuations_propertyId_idx" ON "valuations"("propertyId");

-- CreateIndex
CREATE INDEX "valuations_sellerLeadId_idx" ON "valuations"("sellerLeadId");

-- CreateIndex
CREATE INDEX "valuations_agentId_status_idx" ON "valuations"("agentId", "status");

-- CreateIndex
CREATE INDEX "valuations_createdAt_idx" ON "valuations"("createdAt");

-- CreateIndex
CREATE INDEX "valuation_comparables_valuationId_idx" ON "valuation_comparables"("valuationId");

-- AddForeignKey
ALTER TABLE "seller_leads" ADD CONSTRAINT "seller_leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_leads" ADD CONSTRAINT "seller_leads_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_leads" ADD CONSTRAINT "seller_leads_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_lead_events" ADD CONSTRAINT "seller_lead_events_sellerLeadId_fkey" FOREIGN KEY ("sellerLeadId") REFERENCES "seller_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_sellerLeadId_fkey" FOREIGN KEY ("sellerLeadId") REFERENCES "seller_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "seller_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seller_lead_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "valuations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "valuation_comparables" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['seller_leads', 'seller_lead_events', 'valuations', 'valuation_comparables'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- The owner timeline is append-only (function from the transactions migration).
CREATE TRIGGER h88_seller_lead_events_append_only BEFORE UPDATE OR DELETE ON "seller_lead_events"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();

-- A FINAL valuation is what was presented to the owner: it cannot be edited
-- or deleted. Only links that the database itself clears (a deleted property,
-- owner record or user) may change.
CREATE OR REPLACE FUNCTION public.h88_guard_final_valuation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status <> 'FINAL' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a final valuation cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['propertyId', 'sellerLeadId', 'agentId', 'updatedAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['propertyId', 'sellerLeadId', 'agentId', 'updatedAt']) THEN
    RAISE EXCEPTION 'a final valuation cannot be changed; create a new one';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_valuation_final_guard BEFORE UPDATE OR DELETE ON "valuations"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_final_valuation();

CREATE OR REPLACE FUNCTION public.h88_guard_final_comparable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT v.status INTO parent_status FROM public.valuations v
  WHERE v.id = CASE WHEN TG_OP = 'INSERT' THEN NEW."valuationId" ELSE OLD."valuationId" END;
  IF parent_status = 'FINAL' THEN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'propertyId') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'propertyId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'comparables of a final valuation cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER h88_valuation_comparable_guard BEFORE INSERT OR UPDATE OR DELETE ON "valuation_comparables"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_final_comparable();

-- Trigger functions are not callable through the API.
REVOKE ALL ON FUNCTION public.h88_guard_final_valuation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.h88_guard_final_comparable() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_final_valuation() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_final_comparable() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_final_valuation() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_final_comparable() FROM authenticated';
  END IF;
END $$;
