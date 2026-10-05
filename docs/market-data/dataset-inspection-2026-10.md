# Dataset inspection report — Bank of Greece files and ΜΑΜΑ 2025/2026

Inspected on 5 October 2026, before writing any importer. No code depends on this yet.

Every figure below was read from the files themselves:
- spreadsheets with `xlrd` and `openpyxl`;
- PDFs with `pdftotext -layout`.

## Files

| # | File | Type | Size | SHA-256 |
|---|------|------|------|---------|
| 1 | BG_PRICES_INDICES_HISTORICAL_SERIES.xls | Excel 97 (BIFF) | 125 KB | `7a7a4e00…28421` |
| 2 | NEW_INDEX_OF_APARTMENT_PRICES_BY_GEOGRAPHICAL_AREA.pdf | PDF, 3 data pages + 1 chart page | 983 KB | `b56bef2d…124d4` |
| 3 | NEW_INDEX_OF_APARTMENT_PRICES_BY_AGE.pdf | PDF, 1 page (Excel export) | 368 KB | `0eb53045…0c5f5` |
| 4 | INDICES_OF_RESIDENTIAL_PROPERTY_TRANSACTIONS_WITH_MFI_INTERMEDIATION.pdf | PDF, 1 page (Excel 2010 export, created 2015-08-03) | 299 KB | `73a34a8b…73d2a9` |
| 5 | mhtrwo-ax-met-ak-2025.xlsx (ΜΑΜΑ) | Excel 2007+ | 4.1 MB | `be18b148…bb5e5` |
| 6 | mhtrwo-ax-met-ak-2026.xlsx (ΜΑΜΑ) | Excel 2007+ | 2.5 MB | `452f49e0…d10` |

Licence and terms of use are **not stated in any of the files**, so they are `UNKNOWN / NEEDS_REVIEW`.

---

## 1. BG_PRICES_INDICES_HISTORICAL_SERIES.xls

One sheet, `HISTORICAL SERIES` (217 × 19, no merged cells), holding **five tables stacked vertically**:

| Table | Rows | Base | Frequency | Coverage | Underlying data (footnote) |
|---|---|---|---|---|---|
| Αστικές Περιοχές / Urban Areas | 7–40 | 1997=100 | quarterly + annual avg + annual % | annual 1994–2025*, quarterly 1997Q1–2026Q2* | credit institutions (2006+, apartments only); before 2005 a weighted index of Athens and other urban areas, all dwellings |
| Αθήνα / Athens | 51–84 | 2007=100 | monthly 1997–2005; quarterly 2006–2026Q2* | annual 1993/97–2025* | credit institutions (2006+, apartments only); "Property Ltd" 1997–2005 and "Danos and Associates" 1993–1997 (all dwellings) |
| Θεσσαλονίκη / Thessaloniki | 95–128 | 2007=100 | quarterly + annual | 1993Q4–2026Q2* | credit institutions (2006+, apartments only); BoG branches, mainly real-estate agencies, up to 2005 (all dwellings) |
| Άλλες μεγάλες πόλεις / Other cities | 139–172 | 2007=100 | quarterly + annual | 1993Q4–2026Q2* | same as Thessaloniki |
| Λοιπές Αστικές Περιοχές / Other urban areas (other than Athens) | 185–211 | 1993Q4=100 | quarterly + annual | 1993Q4–**2019Q3 (discontinued)** | branches, mainly real-estate agencies, apartments only |

The columns are: year, Q1, Q2, Q3, Q4, annual average, % change on the previous year. The Athens table has 12 extra monthly columns before the quarters.

How the file marks special cells:
- **Missing values:** `…`.
- **Provisional data:** a year written as text with an asterisk, e.g. `2025*`. Other years are floats such as `2024.0`.
- **Text placeholders:** some cells read "Μόνο ετήσια/τριμηνιαία δεδομένα είναι διαθέσιμα".

**Geography:**
- Defined in the file: "Other cities" means the capitals of all prefectures plus cities larger than their prefecture capital, excluding Athens and Thessaloniki.
- **Not defined** in the file: the boundaries of "Athens".

**Value type:** index levels and % changes only. No € values anywhere.

## 2. NEW_INDEX_OF_APARTMENT_PRICES_BY_GEOGRAPHICAL_AREA.pdf

Three tables, one per page:

- II.7: Total
- II.7.1: New (up to 5 years old)
- II.7.2: Old (over 5 years old)

Page 4 holds chart labels only.

Each table covers 4 areas: Athens, Thessaloniki, Other cities, Other areas. Each area has three columns:
- index (2007=100);
- % change on the previous period;
- % change on the previous year.

Coverage:
- annual 2006–2025* (20 rows per table);
- quarterly 2006Q1–2026Q2* (82 rows per table, all present).

Source: Bank of Greece, data collected from MFIs. 2025Q3 onward is marked provisional.

Parsing traps:
- Some quarter labels use Greek **Ι** (iota) instead of Latin I, for example `ΙII`.
- Years appear only on Q1 rows.
- The chart axis labels are mixed into the text layer.

The overlapping series agree with the XLS within rounding: Athens 2024 annual is 106.48 in the XLS and 106.5 in the PDF. They look like the same series, but this is **not stated** and should be treated as inferred.

## 3. NEW_INDEX_OF_APARTMENT_PRICES_BY_AGE.pdf

Table II.6, national, with three categories: Total, New (up to 5 years old) and Old (over 5 years old). Each has an index (2007=100), % change on the previous period and % change on the previous year.

Coverage: annual 2006–2025*, quarterly 2006Q1–2026Q2* (82 rows). Source: MFIs.

Only these two age bands exist. Age can be used as a category (≤5 / >5 years), never as a continuous curve.

## 4. INDICES_OF_RESIDENTIAL_PROPERTY_TRANSACTIONS_WITH_MFI_INTERMEDIATION.pdf

Table I.2.3, "Indices of residential property **appraisals** with MFI intermediation". This is an **activity** table, not a price table.

| Measure | Unit |
|---|---|
| Number of appraisals | count |
| Volume of appraisals in m² | index, 2007=100 |
| Value of appraisals | index, 2007=100 (total value, not € per property or per m²) |

Each measure also has % change on the previous period and on the previous year.

Coverage: annual 2006–2014*, quarterly 2008Q1–**2015Q2*** (the document dates from 2015). National only. There is no geography, no property-type split and no age split.

The footnote says some appraisals are not connected with a sale. They include loan renegotiations, collateral for non-housing loans and debt transfers. The 2012Q4–2013Q1 jump reflects banks reappraising their portfolios.

**Consequence:** this file cannot benchmark a € valuation. It holds no € value per property or per m², it ends in 2015, and it has no geography. At most it describes historical market activity. A current appraisal-value series (if the Bank of Greece publishes one) would be needed for the cross-check described in the brief.

## 5–6. ΜΑΜΑ 2025 and 2026

Each file has one sheet, `Export Worksheet`, with the same **20 columns**:

| # | Column (exact) | Observed |
|---|---|---|
| 1 | Νομαρχία | 54 prefectures; Attica split into ΑΘΗΝΩΝ / ΠΕΙΡΑΙΩΣ / ΑΝΑΤ. ΑΤΤΙΚΗΣ / ΔΥΤ. ΑΤΤΙΚΗΣ (ΝΟΜΑΡΧΙΑ) |
| 2 | Δήμος Καλλικράτη | 886 (2025) / 812 (2026) municipalities |
| 3 | Δημοτικό ή Κοινοτικό Διαμέρισμα | 3,329 / 2,563 municipal communities. Large cities are split into districts (e.g. `ΑΘΗΝΑΙΩΝ - 1 ΔΙΑΜΕΡΙΣΜΑ` … 7, `ΘΕΣΣΑΛΟΝΙΚΗΣ - 5 ΔΙΑΜ.`). Glyfada is a single unit (`ΓΛΥΦΑΔΑΣ`), with no Άνω/Κάτω split. |
| 4 | Ένδειξη ΑΠΑΑ | Εντός / Εκτός ΑΠΑΑ |
| 5 | Κατηγορία Ακινήτου | 16 / 17 categories (list below) |
| 6 | Πλήθος Προσόψεων | integer, 0–5 |
| 7 | Tιμή Ζώνης | integer €/m², objective-value zone price, 200–10,800; 181 / 105 empty. Header starts with a **Latin** T. |
| 8 | Eπιφάνεια Κύριων Χώρων (σε τ.μ.) | main area, numeric; 7,668 / 4,930 empty (always empty for plots). Header starts with a **Latin** E. |
| 9 | Επιφάνεια Βοηθητικών Χώρων (σε τ.μ.) | auxiliary area, mostly empty |
| 10 | Έτος Κατασκευής | integer; implausible values exist (1000, 1176, 1600) |
| 11 | Είδος Εμπράγματου δικαιώματος Κτίσματος | Πλήρης Κυριότητα / Ψιλή Κυριότητα / Eπικαρπία (Latin E) |
| 12 | Ποσοστό Συνιδιοκτησίας Κτίσματος | % share transferred, 0.04–100 |
| 13 | Ειδικές Συνθήκες Ακινήτου | 7 values, e.g. Ημιτελές κτίσμα, Διατηρητέο, under expropriation, not buildable |
| 14 | Όροφος | text: `Υ` (basement), `0`, `1`…`21` |
| 15 | Επιφάνεια Οικοπέδου (σε τ.μ.) | plot area |
| 16 | Είδος Εμπράγματου δικαιώματος Οικοπέδου | as column 11 |
| 17 | Ποσοστό Συνιδιοκτησίας Οικοπέδου | % |
| 18 | Συνολική Επιφάνεια Κτισμάτων στο οικόπεδο | total built area on the plot |
| 19 | Ημερομηνία Συμβολαίου | Excel date; 2025-01-01 → 2025-12-30 and 2026-01-02 → 2026-10-01 |
| 20 | Τίμημα Δικαιώματος | € price **of the right transferred**; 0 to €175M |

Row counts and data quality:

| | 2025 | 2026 |
|---|---|---|
| Data rows | 41,742 | 25,791 |
| Exact-duplicate rows (beyond the first) | 3,381 | 2,036 |
| Rows sharing date + municipality + community + price | 7,889 rows in 3,493 groups | 4,896 rows in 2,221 groups |
| Price = 0 | 10 | 1 |
| Price < €1,000 | 1,314 | 837 |

Property categories (2025 counts):

| Category | Rows |
|---|---|
| Κατοικία ή διαμέρισμα πλήν μονοκατοικίας | 21,353 |
| Οικόπεδα | 6,565 |
| Μονοκατοικία | 4,277 |
| Αποθήκες / Γεωργικά-Κτηνοτροφικά κτίρια | 3,746 |
| Επαγγελματική Στέγη | 3,393 |
| Θέσεις Στάθμευσης | 1,957 |
| Αθλητικές Εγκαταστάσεις | 109 |
| Ειδικό κτίριο γεωργικής χρήσης | 106 |
| Βιομηχανικά-Βιοτεχνικά κτίρια | 100 |
| Τουριστικές εγκαταστάσεις / Νοσηλευτήρια / Ευαγή | 55 |
| Λοιπά κτίρια | 25 |
| Οικόπεδο εντός επιχειρηματικού πάρκου (Ν. 3982/2011) | 18 |
| Εκπαιδευτήρια | 15 |
| Ειδικό κτίριο κτηνοτροφικής χρήσης | 14 |
| Οικόπεδο εντός βιομηχανικής περιοχής (Ν 4458/1985) | 8 |
| Σταθμοί αυτοκινήτων δημόσιας χρήσης | 1 |

2026 adds one more: "Οικόπεδο εντός βιομηχανικής επιχειρηματικής περιοχής (Ν 2545/1997)".

**Encoding and number format:**
- UTF-8 Greek, with a few Latin look-alike letters as noted in the column table.
- Numbers are native xlsx numerics, with no decimal-comma parsing needed.
- The floor is stored as text.

### What ΜΑΜΑ does not contain

- No record id, contract id, address, coordinates, bedrooms, bathrooms, condition, energy class or features. Idempotency must come from file hash + row number + a content hash.
- No neighbourhood below the municipal community.

### Critical: multi-item contracts

The **same price appears on several rows** of the same date and place, with different items: for example an apartment + a storage room + a plot, each at €185,000. This strongly suggests `Τίμημα Δικαιώματος` is the **contract total repeated on every item**.

There is no contract id, so the grouping is inferred, not stated. Dividing such a price by one row's area overstates €/m². The importer must flag these rows and keep them out of €/m² comparables until the inference is accepted.

### Partial rights

`Ψιλή Κυριότητα`, `Eπικαρπία` and co-ownership below 100% transfer only part of a property, and the price is for that part. Only `Πλήρης Κυριότητα` at 100% is directly comparable.

### Price sanity (apartments, full ownership 100%, main area ≥ 15 m², price > 0)

| | 2025 | 2026 |
|---|---|---|
| Rows | 15,367 | 9,376 |
| p1 €/m² | 89 | 98 |
| p5 €/m² | 282 | 325 |
| Median €/m² | 1,345 | 1,442 |
| p95 €/m² | 3,433 | 3,973 |
| p99 €/m² | 5,848 | 7,331 |
| Price within ±10% of zone value × area | 14% | 14% |

The low tail needs robust filtering. The 14% figure gives no evidence that prices are systematically declared at objective value, but under-declaration can't be ruled out from this data.

Glyfada example: 169 filtered apartment sales in 2025 (median €3,333/m²) and 76 in 2026 (€3,642/m²), all under the single community `ΓΛΥΦΑΔΑΣ`.

---

## What each file can and cannot do

| File | Can produce | Calibration only | Cannot be used for |
|---|---|---|---|
| ΜΑΜΑ 2025/2026 | Absolute €/m² comparables (transactions), at municipality / municipal-community level, once filtered as described above | Zone value (`Tιμή Ζώνης`) as an objective-value reference | Neighbourhood-level comparables; feature, condition or room matching; multi-item rows; partial rights |
| BoG geography (II.7.x) | — | Time adjustment of older comparables within the **same** series: Athens / Thessaloniki / Other cities / Other areas × total / new ≤5 / old >5, quarterly to 2026Q2* | Any € value; anything below these 4 areas; non-apartment types |
| BoG age (II.6) | — | National new vs. old context | Continuous age premiums |
| BoG historical XLS | — | Long-run context; the newer segments overlap II.7 | € values; "Other urban areas" after 2019Q3 |
| BoG MFI appraisals (I.2.3) | — | Historical activity context only | Any valuation cross-check (no € values, ends 2015Q2, national only) |

## Open points before coding

1. Treat rows that share date + place + price as one multi-item contract and exclude them from €/m²? (Recommended: yes, flagged and kept.)
2. Comparables only from `Πλήρης Κυριότητα` at 100% share? (Recommended: yes.)
3. The boundaries of BoG "Athens" are not defined in the files. Mapping ΑΘΗΝΩΝ / ΠΕΙΡΑΙΩΣ / ΑΝΑΤ. / ΔΥΤ. ΑΤΤΙΚΗΣ to "Athens" needs a documented decision (`NEEDS_REVIEW`).
4. A current MFI appraisal-value table is needed if an institutional cross-check is wanted. The supplied one ends in 2015.
5. Spreadsheet parsing in production: the importer needs an xlsx/xls reader dependency in Node. The legacy .xls is a different format from the .xlsx.
