import type { PortalAdapter } from "../types";
import { manualAdapter } from "./manual";
import { spitogatosAdapter } from "./spitogatos";
import { xeGrAdapter } from "./xe";

export { manualAdapter, spitogatosAdapter, xeGrAdapter };

const registry = new Map<string, PortalAdapter>(
  [spitogatosAdapter, xeGrAdapter, manualAdapter].map((adapter) => [adapter.code, adapter]),
);

export function getAdapter(code: string): PortalAdapter | undefined {
  return registry.get(code.toUpperCase());
}

export function requireAdapter(code: string): PortalAdapter {
  const adapter = getAdapter(code);
  if (!adapter) {
    throw new Error(`No portal adapter registered for "${code}".`);
  }
  return adapter;
}

export function listAdapters(): PortalAdapter[] {
  return [...registry.values()];
}

/** Lets a deployment add a portal without forking this package. */
export function registerAdapter(adapter: PortalAdapter): void {
  registry.set(adapter.code.toUpperCase(), adapter);
}
