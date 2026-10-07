-- Removes the three added tags (assignments cascade). Label changes are not reverted.
DELETE FROM "property_tags" WHERE "code" IN ('SITE', 'PHONE_EFTHYMIS', 'GOLDEN_DEAL') AND "isSystem" = true;
