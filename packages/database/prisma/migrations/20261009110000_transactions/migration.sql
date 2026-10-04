-- Transactions: negotiation rounds on offers, the transaction record, an
-- append-only timeline, commission snapshots and a document checklist.
-- Additive: existing offers keep working (transactionId stays NULL).

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deposit" DECIMAL(14,2),
ADD COLUMN     "financing" TEXT,
ADD COLUMN     "parentOfferId" TEXT,
ADD COLUMN     "party" TEXT NOT NULL DEFAULT 'BUYER',
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "respondedById" TEXT,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "transactionId" TEXT;

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEGOTIATION',
    "propertyId" TEXT NOT NULL,
    "buyerContactId" TEXT,
    "sellerContactId" TEXT,
    "leadId" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "buyerEmail" TEXT,
    "agentId" TEXT,
    "agreedAmount" DECIMAL(14,2),
    "acceptedOfferId" TEXT,
    "agreementAt" TIMESTAMP(3),
    "contractAt" TIMESTAMP(3),
    "expectedCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_events" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_commissions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "buyerSide" DECIMAL(14,2) NOT NULL,
    "sellerSide" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "agentShare" DECIMAL(14,2) NOT NULL,
    "agencyShare" DECIMAL(14,2) NOT NULL,
    "minimumApplied" BOOLEAN NOT NULL DEFAULT false,
    "rulesSnapshot" JSONB NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "invoiceNumber" TEXT,
    "dueDate" DATE,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "calculatedById" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_checklist_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "documentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_acceptedOfferId_key" ON "transactions"("acceptedOfferId");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_propertyId_idx" ON "transactions"("propertyId");

-- CreateIndex
CREATE INDEX "transactions_agentId_status_idx" ON "transactions"("agentId", "status");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE INDEX "transaction_events_transactionId_createdAt_idx" ON "transaction_events"("transactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_commissions_transactionId_key" ON "transaction_commissions"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_commissions_status_idx" ON "transaction_commissions"("status");

-- CreateIndex
CREATE INDEX "transaction_checklist_items_transactionId_idx" ON "transaction_checklist_items"("transactionId");

-- CreateIndex
CREATE INDEX "offers_transactionId_round_idx" ON "offers"("transactionId", "round");

-- CreateIndex
CREATE INDEX "documents_transactionId_idx" ON "documents"("transactionId");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_parentOfferId_fkey" FOREIGN KEY ("parentOfferId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyerContactId_fkey" FOREIGN KEY ("buyerContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sellerContactId_fkey" FOREIGN KEY ("sellerContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_commissions" ADD CONSTRAINT "transaction_commissions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_checklist_items" ADD CONSTRAINT "transaction_checklist_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_checklist_items" ADD CONSTRAINT "transaction_checklist_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction_commissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction_checklist_items" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transactions', 'transaction_events', 'transaction_commissions', 'transaction_checklist_items'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- Negotiation history is immutable. A round's terms never change; its status
-- moves once, out of SUBMITTED; rounds of a transaction are never deleted.
CREATE OR REPLACE FUNCTION public.h88_guard_offer_round() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."transactionId" IS NOT NULL THEN
      RAISE EXCEPTION 'offer rounds of a transaction cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."transactionId" IS NOT NULL AND (
       NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.conditions IS DISTINCT FROM OLD.conditions
    OR NEW.party IS DISTINCT FROM OLD.party
    OR NEW.financing IS DISTINCT FROM OLD.financing
    OR NEW.deposit IS DISTINCT FROM OLD.deposit
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."transactionId" IS DISTINCT FROM OLD."transactionId"
    OR NEW."parentOfferId" IS DISTINCT FROM OLD."parentOfferId"
    OR NEW.round IS DISTINCT FROM OLD.round
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt") THEN
    RAISE EXCEPTION 'offer round terms are immutable; record a counter-offer instead';
  END IF;
  IF OLD."transactionId" IS NOT NULL AND OLD.status <> 'SUBMITTED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'offer round already answered';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_offer_round_guard BEFORE UPDATE OR DELETE ON "offers"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_offer_round();

-- The transaction timeline is append-only.
CREATE OR REPLACE FUNCTION public.h88_guard_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER h88_transaction_events_append_only BEFORE UPDATE OR DELETE ON "transaction_events"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();

-- Trigger functions are not callable through the API.
REVOKE ALL ON FUNCTION public.h88_guard_offer_round() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.h88_guard_append_only() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_offer_round() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_append_only() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_offer_round() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_append_only() FROM authenticated';
  END IF;
END $$;
