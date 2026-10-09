/**
 * The shape of the unified Publication panel, shared by the API that computes it
 * and the CRM that shows it. Everything a person sees about a channel (its state,
 * why it is held back, what they may do next) is calculated on the server and
 * carried here; the screen never works any of it out from missing fields.
 */

export type ChannelKind = "WEBSITE" | "PORTAL";

/**
 * What the next publish would do:
 *  READY          it would go out
 *  BLOCKED        held back; `blockers` say why
 *  NOT_SELECTED   not going out because no rule or selection includes it
 *  NOT_CONFIGURED nothing can be published there yet (no adapter or account)
 */
export type ChannelReadiness = "READY" | "BLOCKED" | "NOT_SELECTED" | "NOT_CONFIGURED";

export type ChannelActions = {
  validate: boolean;
  preview: boolean;
  publish: boolean;
  update: boolean;
  unpublish: boolean;
  retry: boolean;
};

export type ChannelAccountChoice = {
  id: string;
  accountName: string;
  environment: "TEST" | "PRODUCTION";
  status: string;
  enabled: boolean;
  /** `mock` is the in-process test provider: nothing reaches a real portal. */
  providerKind: "mock" | "real" | "none";
};

export type ChannelView = {
  kind: ChannelKind;
  /** "WEBSITE" or the portal code. */
  code: string;
  name: string;
  /** The effective state: for the website this includes OUTDATED when the content moved since the last generation. */
  status: string;
  /** Website: it is selected for publication. Portal: a publication rule includes it. */
  selected: boolean;
  readiness: ChannelReadiness;
  blockers: string[];
  warnings: string[];
  /** The public page (website, only when a visitor can open it) or the portal's listing address. */
  url: string | null;
  externalId: string | null;
  lastSuccessAt: string | null;
  lastFailedAt: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  lastActionBy: string | null;
  lastError: string | null;
  needsReview: boolean;
  nextRetryAt: string | null;
  /** True when a publish here would use the in-process mock: it never reaches a real portal. */
  mock: boolean;
  /** A real or mock provider exists, so publishing is possible. False = no Publish button. */
  operational: boolean;
  note: string | null;
  actions: ChannelActions;
  accountId: string | null;
  accounts: ChannelAccountChoice[];
  /** Website only. */
  website?: {
    visibility: string;
    noIndex: boolean;
    sitemapIncluded: boolean;
    contentChanged: boolean;
    visible: boolean;
    seoTitle: string | null;
    seoDescription: string | null;
    lastPublishedAt: string | null;
    lastUnpublishedAt: string | null;
    hash: string;
    photoCount: number;
  };
};

export type PublicationsPayload = {
  property: { id: string; reference: string; status: string; listingType: string };
  website: ChannelView;
  portals: ChannelView[];
  generatedAt: string;
};

export type ChannelOperation = "validate" | "preview" | "publish" | "update" | "unpublish";

export type ChannelRequest = { code: string; accountId?: string; environment?: "TEST" | "PRODUCTION" };

/**
 * One channel's outcome. `ok` means the operation did what was asked (including
 * "nothing to change"); a blocked, failed or rejected channel is `ok: false` and
 * says why. Channels never undo each other.
 */
export type ChannelResult = {
  channel: string;
  kind: ChannelKind;
  ok: boolean;
  status: string;
  message: string;
  blockers: string[];
  warnings: string[];
  /** The result came from the in-process mock, not a real portal. */
  mock: boolean;
  url: string | null;
  externalId: string | null;
  hash: string | null;
  /** Website only: whether the public page was refreshed straight away. */
  revalidation: { attempted: boolean; ok: boolean; note: string } | null;
  /** Previews only. */
  preview: Record<string, unknown> | null;
  errorCode: string | null;
  needsReview: boolean;
};

export type PublicationsOperationResponse = {
  operation: ChannelOperation;
  ok: boolean;
  summary: { ok: number; failed: number };
  results: ChannelResult[];
};
