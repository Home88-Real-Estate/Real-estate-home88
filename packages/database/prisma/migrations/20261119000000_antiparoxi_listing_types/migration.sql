-- Add separate transaction types for land-for-units exchange.
-- ASSIGNMENT remains unchanged for legacy contract-transfer listings.
ALTER TYPE "ListingType" ADD VALUE IF NOT EXISTS 'ANTIPAROXI';
ALTER TYPE "ListingType" ADD VALUE IF NOT EXISTS 'SALE_ANTIPAROXI';
