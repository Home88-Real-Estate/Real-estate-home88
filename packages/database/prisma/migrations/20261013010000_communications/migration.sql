-- Client communications: message templates, the outbound message log, SMS
-- opt-out, and once-only reminder markers. Additive.

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "smsOptOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "dueNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "viewings" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'SERVICE',
    "locale" TEXT NOT NULL DEFAULT 'el',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contactId" TEXT,
    "propertyId" TEXT,
    "leadId" TEXT,
    "transactionId" TEXT,
    "sellerLeadId" TEXT,
    "viewingId" TEXT,
    "templateId" TEXT,
    "toEncrypted" TEXT,
    "subject" TEXT,
    "bodyEncrypted" TEXT,
    "segments" INTEGER,
    "emailLogId" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_templates_channel_active_idx" ON "message_templates"("channel", "active");

-- CreateIndex
CREATE INDEX "messages_contactId_createdAt_idx" ON "messages"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_propertyId_idx" ON "messages"("propertyId");

-- CreateIndex
CREATE INDEX "messages_status_createdAt_idx" ON "messages"("status", "createdAt");

-- CreateIndex
CREATE INDEX "messages_providerMessageId_idx" ON "messages"("providerMessageId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_templates', 'messages'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- The message log is a record of what was said to a client: it is never
-- deleted and its recipient, wording and context never change. Only delivery
-- progress moves, and links the database itself clears (deleted contact,
-- property, template or user).
CREATE OR REPLACE FUNCTION public.h88_guard_message() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY['status', 'providerMessageId', 'error', 'sentAt', 'emailLogId',
    'contactId', 'propertyId', 'templateId', 'sentById'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messages are a permanent record and cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'a sent message cannot be rewritten';
  END IF;
  IF (NEW."contactId" IS DISTINCT FROM OLD."contactId" AND NEW."contactId" IS NOT NULL)
     OR (NEW."propertyId" IS DISTINCT FROM OLD."propertyId" AND NEW."propertyId" IS NOT NULL)
     OR (NEW."templateId" IS DISTINCT FROM OLD."templateId" AND NEW."templateId" IS NOT NULL)
     OR (NEW."sentById" IS DISTINCT FROM OLD."sentById" AND NEW."sentById" IS NOT NULL) THEN
    RAISE EXCEPTION 'a sent message cannot be moved to another record';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_message_guard BEFORE UPDATE OR DELETE ON "messages"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_message();

-- Trigger functions are not callable through the API.
REVOKE ALL ON FUNCTION public.h88_guard_message() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_message() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_message() FROM authenticated';
  END IF;
END $$;
