-- Automation settings and its run log, AI settings and its usage log. Additive.
-- The run log and the usage log are append-only records. The usage log never
-- holds a prompt or an answer.

-- CreateTable
CREATE TABLE "automation_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "leadStaleDays" INTEGER,
    "viewingFollowUpDays" INTEGER,
    "mandateExpiryDays" INTEGER,
    "offerExpiryDays" INTEGER,
    "sellerFollowUpOverdueDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "episode" TEXT NOT NULL,
    "taskId" TEXT,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT,
    "model" TEXT,
    "enabled" BOOLEAN,
    "allowDescriptions" BOOLEAN,
    "allowReportSummaries" BOOLEAN,
    "hourlyLimitPerUser" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_runs_createdAt_idx" ON "automation_runs"("createdAt");

-- CreateIndex
CREATE INDEX "automation_runs_rule_createdAt_idx" ON "automation_runs"("rule", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_rule_entityId_episode_key" ON "automation_runs"("rule", "entityId", "episode");

-- CreateIndex
CREATE INDEX "ai_requests_userId_createdAt_idx" ON "ai_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_requests_createdAt_idx" ON "ai_requests"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "automation_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_settings', 'automation_runs', 'ai_settings', 'ai_requests'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- Append-only: rows are never deleted and never rewritten. The one exception
-- is the database clearing the user link when a user is removed.
CREATE OR REPLACE FUNCTION public.h88_guard_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := CASE TG_TABLE_NAME WHEN 'ai_requests' THEN ARRAY['userId'] ELSE ARRAY[]::text[] END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is an append-only record and cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '% is an append-only record and cannot be changed', TG_TABLE_NAME;
  END IF;
  IF 'userId' = ANY(mutable)
     AND (to_jsonb(NEW)->>'userId') IS NOT NULL
     AND (to_jsonb(NEW)->>'userId') IS DISTINCT FROM (to_jsonb(OLD)->>'userId') THEN
    RAISE EXCEPTION '% cannot be moved to another user', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_automation_runs_guard BEFORE UPDATE OR DELETE ON "automation_runs"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();
CREATE TRIGGER h88_ai_requests_guard BEFORE UPDATE OR DELETE ON "ai_requests"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();

-- Trigger functions are not callable through the API.
REVOKE ALL ON FUNCTION public.h88_guard_append_only() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_append_only() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_append_only() FROM authenticated';
  END IF;
END $$;
