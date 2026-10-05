/**
 * @home88/valuation
 *
 * Pure, database-free valuation engine. Callers load real observations
 * (HOME88 listings and closed deals, imported market data), map them to
 * `Candidate`, and receive either a range with a full, reproducible
 * explanation or an explicit INSUFFICIENT_DATA.
 */

export * from "./engine";
