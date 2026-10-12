import type { DirectoryRow, DistributionStatus } from "@home88/domain";

export type DirectoryResponse = { data: DirectoryRow[]; total: number; counts: Record<DistributionStatus, number> };

export const STATUS_BADGE: Record<DistributionStatus, string> = {
  CATALOG_ONLY: "badge badge--muted",
  NEEDS_SPECIFICATION: "badge badge--muted",
  AWAITING_ACCOUNT: "badge badge--warn",
  READY_FOR_TEST: "badge badge--info",
  CONNECTED: "badge badge--ok",
  SYNC_ERROR: "badge badge--danger",
  PAUSED: "badge badge--muted",
  UNSUPPORTED: "badge badge--muted",
};
