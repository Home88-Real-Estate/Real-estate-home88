import type { PortalSyncState, SyncAction } from "./types";

export type PlannedSync = {
  /** null means there is nothing to do. */
  action: SyncAction | null;
  reason: string;
};

export type SyncPlanInput = {
  eligible: boolean;
  /** Content hash of the property as it is now. */
  currentHash: string;
  /** Hash of the payload we last successfully pushed, if any. */
  lastPayloadHash: string | null;
  state: PortalSyncState;
  /** Re-push even if the content hash is unchanged. */
  force?: boolean;
};

const ALREADY_LISTED: PortalSyncState[] = ["PUBLISHED", "OUTDATED", "QUEUED", "PUBLISHING"];

/**
 * Chooses the sync action for one property/portal pair.
 *
 * This is the single place that decides publish vs. update vs. delist, so the
 * worker and any manual "republish" button can share it rather than reimplement
 * the state machine and drift apart.
 */
export function planSync(input: SyncPlanInput): PlannedSync {
  const { eligible, currentHash, lastPayloadHash, state, force } = input;

  if (!eligible) {
    if (ALREADY_LISTED.includes(state)) {
      return { action: "REMOVE", reason: `delist (${state.toLowerCase()})` };
    }
    return { action: null, reason: "not eligible and nothing is listed" };
  }

  if (force) {
    return state === "PUBLISHED"
      ? { action: "REPUBLISH", reason: "forced republish" }
      : { action: "PUBLISH", reason: "forced publish" };
  }

  switch (state) {
    case "PUBLISHED":
      return currentHash === lastPayloadHash
        ? { action: null, reason: "unchanged" }
        : { action: "UPDATE", reason: "content changed" };
    case "OUTDATED":
      return { action: "UPDATE", reason: "content changed" };
    case "PUBLISHING":
    case "QUEUED":
      return { action: null, reason: "already queued" };
    case "NOT_PUBLISHED":
    case "REMOVED":
    case "FAILED":
      return { action: "PUBLISH", reason: "not yet published" };
    default:
      return { action: "PUBLISH", reason: "not yet published" };
  }
}
