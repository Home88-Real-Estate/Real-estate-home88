/**
 * Detects an asking-price or rent change so it can be recorded before the
 * old value is overwritten. Prisma returns Decimal objects while validated
 * input carries numbers, so both are compared as numbers.
 */

type Money = number | string | { toString(): string } | null | undefined;

export type PriceSnapshot = { price: Money; monthlyRent: Money };

export type PriceChange = {
  fromPrice: number | null;
  toPrice: number | null;
  fromMonthlyRent: number | null;
  toMonthlyRent: number | null;
};

function toNumber(value: Money): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

/** The change between two snapshots, or null when neither amount moved. */
export function priceChange(before: PriceSnapshot, after: PriceSnapshot): PriceChange | null {
  const change: PriceChange = {
    fromPrice: toNumber(before.price),
    toPrice: toNumber(after.price),
    fromMonthlyRent: toNumber(before.monthlyRent),
    toMonthlyRent: toNumber(after.monthlyRent),
  };
  const moved =
    change.fromPrice !== change.toPrice || change.fromMonthlyRent !== change.toMonthlyRent;
  return moved ? change : null;
}
