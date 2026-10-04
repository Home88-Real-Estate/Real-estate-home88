-- New audit entities for the owner pipeline and valuations. Own migration:
-- an enum value must be committed before anything can use it.
ALTER TYPE "AuditEntity" ADD VALUE 'SELLER_LEAD';
ALTER TYPE "AuditEntity" ADD VALUE 'VALUATION';
