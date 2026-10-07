-- Property tags: align labels with the agency's Estate+ tag names and add the three
-- tags that did not exist yet. Additive and idempotent: labels are changed only while
-- they still hold the original seed text (an edit made in Settings is never overwritten).
UPDATE "property_tags" SET "labelEl" = 'Πήραμε τηλ. και είναι διαθέσιμο', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'CONTACTED' AND "labelEl" = 'Επικοινωνήσαμε — διαθέσιμο';
UPDATE "property_tags" SET "labelEl" = 'Πήραμε δεν απάντησε', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'NO_ANSWER' AND "labelEl" = 'Δεν απάντησε';
UPDATE "property_tags" SET "labelEl" = 'Έχει λάθος τηλ', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'WRONG_PHONE' AND "labelEl" = 'Λάθος τηλέφωνο';
UPDATE "property_tags" SET "labelEl" = 'Να μην δημοσιευθεί πουθενά', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'DO_NOT_PUBLISH' AND "labelEl" = 'Να μη δημοσιευθεί';
UPDATE "property_tags" SET "labelEl" = 'Αποκλειστική Ανάθεση', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'EXCLUSIVE' AND "labelEl" = 'Αποκλειστική ανάθεση';
UPDATE "property_tags" SET "labelEl" = 'Μόνο site μας', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'WEBSITE_ONLY' AND "labelEl" = 'Μόνο στον ιστότοπο';
UPDATE "property_tags" SET "labelEl" = 'Αντιπαροχή / Δίνεται και Αντιπαροχή', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'ANTIPAROCHI' AND "labelEl" = 'Αντιπαροχή';
UPDATE "property_tags" SET "labelEl" = 'Να κοιτάξουμε σημειώσεις!!', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'REVIEW_NOTES' AND "labelEl" = 'Έλεγχος σημειώσεων';

INSERT INTO "property_tags" ("id", "code", "labelEl", "labelEn", "color", "isSystem", "legacyLabels", "sortOrder", "updatedAt") VALUES
  ('tag_site', 'SITE', 'Site', 'Site', 'blue', true, ARRAY['Site']::text[], 140, CURRENT_TIMESTAMP),
  ('tag_phone_efthymis', 'PHONE_EFTHYMIS', 'Τηλ Ευθύμης', 'Efthymis phone', 'slate', true, ARRAY['Τηλ Ευθύμης']::text[], 150, CURRENT_TIMESTAMP),
  ('tag_golden_deal', 'GOLDEN_DEAL', 'Χρυσή Ευκαιρία', 'Golden opportunity', 'amber', true, ARRAY['Χρυσή Ευκαιρία']::text[], 160, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
