-- A staff account can exist before its owner has chosen a password (the
-- bootstrapped first administrator sets theirs through the reset link).
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Link to the person's external identity-provider user id (Supabase Auth).
ALTER TABLE "users" ADD COLUMN "authUid" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "users_authUid_key" ON "users"("authUid");
