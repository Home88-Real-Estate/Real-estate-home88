-- Digital mandates: the mandate, its signing parties and an append-only
-- timeline. Additive: new tables only.

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "number" TEXT,
    "type" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'el',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "propertyId" TEXT,
    "sellerLeadId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "terms" JSONB NOT NULL DEFAULT '{}',
    "templateVersionId" TEXT,
    "templateChecksum" TEXT,
    "renderedTextEncrypted" TEXT,
    "renderedChecksum" TEXT,
    "pdfDocumentId" TEXT,
    "pdfChecksum" TEXT,
    "signedDocumentId" TEXT,
    "signedChecksum" TEXT,
    "signatureMethod" TEXT,
    "signatureProvider" TEXT,
    "signatureLevel" TEXT,
    "envelopeId" TEXT,
    "signingExpiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "agentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_parties" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contactId" TEXT,
    "fullName" TEXT NOT NULL,
    "taxIdEncrypted" TEXT,
    "idNumberEncrypted" TEXT,
    "addressEncrypted" TEXT,
    "emailEncrypted" TEXT,
    "phoneEncrypted" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_events" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mandates_reference_key" ON "mandates"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_number_key" ON "mandates"("number");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_pdfDocumentId_key" ON "mandates"("pdfDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_signedDocumentId_key" ON "mandates"("signedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_envelopeId_key" ON "mandates"("envelopeId");

-- CreateIndex
CREATE INDEX "mandates_status_idx" ON "mandates"("status");

-- CreateIndex
CREATE INDEX "mandates_propertyId_type_status_idx" ON "mandates"("propertyId", "type", "status");

-- CreateIndex
CREATE INDEX "mandates_sellerLeadId_idx" ON "mandates"("sellerLeadId");

-- CreateIndex
CREATE INDEX "mandates_agentId_status_idx" ON "mandates"("agentId", "status");

-- CreateIndex
CREATE INDEX "mandates_createdAt_idx" ON "mandates"("createdAt");

-- CreateIndex
CREATE INDEX "mandate_parties_mandateId_idx" ON "mandate_parties"("mandateId");

-- CreateIndex
CREATE INDEX "mandate_parties_contactId_idx" ON "mandate_parties"("contactId");

-- CreateIndex
CREATE INDEX "mandate_events_mandateId_createdAt_idx" ON "mandate_events"("mandateId", "createdAt");

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_sellerLeadId_fkey" FOREIGN KEY ("sellerLeadId") REFERENCES "seller_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "mandate_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_pdfDocumentId_fkey" FOREIGN KEY ("pdfDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_parties" ADD CONSTRAINT "mandate_parties_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_parties" ADD CONSTRAINT "mandate_parties_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_events" ADD CONSTRAINT "mandate_events_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "mandates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_parties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_events" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mandates', 'mandate_parties', 'mandate_events'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- The mandate timeline is append-only (function from the transactions migration).
CREATE TRIGGER h88_mandate_events_append_only BEFORE UPDATE OR DELETE ON "mandate_events"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();

-- Once issued, what the client signs cannot change: number, type, terms,
-- template, text and PDF are frozen; only the signing progress moves. A
-- final mandate (signed, declined, expired, cancelled) does not change at
-- all. Links the database itself clears (deleted property, owner record,
-- user) are always allowed.
CREATE OR REPLACE FUNCTION public.h88_guard_mandate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  links text[] := ARRAY['propertyId', 'sellerLeadId', 'agentId', 'updatedAt'];
  progress text[] := ARRAY['status', 'sentAt', 'viewedAt', 'signedAt', 'declinedAt', 'expiredAt', 'cancelledAt',
    'cancelReason', 'signatureMethod', 'signatureProvider', 'signatureLevel', 'envelopeId', 'signingExpiresAt',
    'signedDocumentId', 'signedChecksum'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'an issued mandate cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED') THEN
    IF (to_jsonb(NEW) - links) IS DISTINCT FROM (to_jsonb(OLD) - links) THEN
      RAISE EXCEPTION 'a % mandate cannot be changed', lower(OLD.status);
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - links - progress) IS DISTINCT FROM (to_jsonb(OLD) - links - progress) THEN
    RAISE EXCEPTION 'an issued mandate cannot be edited; cancel it and create a new one';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_mandate_guard BEFORE UPDATE OR DELETE ON "mandates"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_mandate();

-- The signing parties are fixed once the mandate is issued; only their
-- signing time is recorded (and a deleted contact link cleared).
CREATE OR REPLACE FUNCTION public.h88_guard_mandate_party() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT m.status INTO parent_status FROM public.mandates m
  WHERE m.id = CASE WHEN TG_OP = 'INSERT' THEN NEW."mandateId" ELSE OLD."mandateId" END;
  IF parent_status IS NULL OR parent_status = 'DRAFT' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['signedAt', 'contactId']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['signedAt', 'contactId'])
     AND (OLD."signedAt" IS NULL OR NEW."signedAt" IS NOT DISTINCT FROM OLD."signedAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'the parties of an issued mandate cannot be changed';
END $$;

CREATE TRIGGER h88_mandate_party_guard BEFORE INSERT OR UPDATE OR DELETE ON "mandate_parties"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_mandate_party();

-- Trigger functions are not callable through the API.
REVOKE ALL ON FUNCTION public.h88_guard_mandate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.h88_guard_mandate_party() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_mandate() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_mandate_party() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_mandate() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_mandate_party() FROM authenticated';
  END IF;
END $$;
