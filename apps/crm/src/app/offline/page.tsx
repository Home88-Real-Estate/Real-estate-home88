import type { Metadata } from "next";

import { OfflinePage } from "@/components/offline/OfflinePage";

export const metadata: Metadata = { title: "Καταχωρίσεις στη συσκευή" };

/**
 * Static and public on purpose: it holds no data of its own (everything shown comes from this device's
 * IndexedDB), so the service worker can keep a copy and show it when the CRM cannot be reached.
 */
export const dynamic = "force-static";

export default function Page() {
  return <OfflinePage />;
}
