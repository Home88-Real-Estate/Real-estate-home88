/**
 * What a portal integration can actually do.
 *
 * The UI derives its buttons from this, so a portal that cannot delete never
 * shows "Delete". Defaults come from the transport and describe only what the
 * code in this repository really performs; an adapter may override a field when
 * a verified provider contract says otherwise. A catalogue entry with no
 * adapter has no capabilities at all, which keeps a planned integration from
 * being presented as a working one.
 */

import type { PortalAdapter, PortalTransport } from "./types";

export type PortalCapabilities = {
  create: boolean;
  update: boolean;
  unpublish: boolean;
  delete: boolean;
  /** The portal collects a document from a URL we serve. */
  pull: boolean;
  /** We call the portal's API. */
  push: boolean;
  webhooks: boolean;
  leads: boolean;
  images: boolean;
  video: boolean;
  virtualTour: boolean;
  incrementalSync: boolean;
  fullSync: boolean;
  dryRun: boolean;
};

export const NO_CAPABILITIES: PortalCapabilities = {
  create: false,
  update: false,
  unpublish: false,
  delete: false,
  pull: false,
  push: false,
  webhooks: false,
  leads: false,
  images: false,
  video: false,
  virtualTour: false,
  incrementalSync: false,
  fullSync: false,
  dryRun: false,
};

/**
 * A feed carries the whole set: adding, changing or omitting a listing is how a
 * property is created, updated or withdrawn. There is no delete call and no
 * incremental protocol, and nothing flows back.
 */
const FEED_CAPABILITIES: PortalCapabilities = {
  ...NO_CAPABILITIES,
  create: true,
  update: true,
  unpublish: true,
  pull: true,
  images: true,
  video: true,
  virtualTour: true,
  fullSync: true,
  dryRun: true,
};

/** A human posts the listing; we only track it and prepare the posting sheet. */
const MANUAL_CAPABILITIES: PortalCapabilities = { ...NO_CAPABILITIES, images: true, dryRun: true };

export function capabilitiesFor(transport: PortalTransport, adapter?: PortalAdapter | null): PortalCapabilities {
  if (!adapter) return { ...NO_CAPABILITIES };
  const base =
    transport === "MANUAL"
      ? MANUAL_CAPABILITIES
      : transport === "API"
        ? NO_CAPABILITIES // no API client exists yet; an adapter must declare what it really does
        : FEED_CAPABILITIES;
  return { ...base, ...(adapter.capabilities ?? {}) };
}

/** Lifecycle of an integration, from catalogue entry to live. */
export type IntegrationStatus =
  | "PLANNED"
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "CONNECTED"
  | "TESTED"
  | "ACTIVE"
  | "ERROR"
  | "DISABLED";

export type PortalAction =
  | "configure"
  | "testConnection"
  | "preview"
  | "syncNow"
  | "unpublish"
  | "delete"
  | "viewFeed"
  | "viewLogs"
  | "importLeads";

const CAN_RUN: IntegrationStatus[] = ["CONFIGURED", "CONNECTED", "TESTED", "ACTIVE"];

/**
 * Buttons a portal may show. `syncNow` needs a configured portal; `delete` and
 * `unpublish` need the provider to support them; nothing runs on a disabled or
 * planned integration.
 */
export function availableActions(caps: PortalCapabilities, status: IntegrationStatus): PortalAction[] {
  const actions: PortalAction[] = ["viewLogs"];
  if (status !== "PLANNED") actions.unshift("configure");
  if (status === "PLANNED" || status === "DISABLED") return actions;

  if (caps.push) actions.push("testConnection");
  if (caps.dryRun) actions.push("preview");
  if (caps.pull) actions.push("viewFeed");

  if (CAN_RUN.includes(status)) {
    if (caps.fullSync || caps.incrementalSync || caps.push) actions.push("syncNow");
    if (caps.unpublish) actions.push("unpublish");
    if (caps.delete) actions.push("delete");
    if (caps.leads) actions.push("importLeads");
  }
  return actions;
}
