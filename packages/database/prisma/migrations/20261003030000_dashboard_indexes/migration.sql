-- CreateIndex
CREATE INDEX "properties_updatedAt_idx" ON "properties"("updatedAt");

-- CreateIndex
CREATE INDEX "property_status_history_toStatus_createdAt_idx" ON "property_status_history"("toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "property_media_status_idx" ON "property_media"("status");

-- CreateIndex
CREATE INDEX "leads_assignedToId_createdAt_idx" ON "leads"("assignedToId", "createdAt");

-- CreateIndex
CREATE INDEX "viewings_status_startsAt_idx" ON "viewings"("status", "startsAt");

-- CreateIndex
CREATE INDEX "viewings_startsAt_idx" ON "viewings"("startsAt");

-- CreateIndex
CREATE INDEX "offers_createdAt_idx" ON "offers"("createdAt");

-- CreateIndex
CREATE INDEX "offers_agentId_createdAt_idx" ON "offers"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "portal_listings_state_idx" ON "portal_listings"("state");

