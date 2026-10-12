import type { Metadata } from "next";
import Link from "next/link";

import { DistributionWorkspace, type Destination, type WorkspaceRow } from "@/components/DistributionWorkspace";
import { apiFetch } from "@/lib/api";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Διανομή ακινήτων" };

const FILTERS = ["q", "city", "listingType", "statusGroup", "portalState", "mine"] as const;

type Listing = { data: WorkspaceRow[]; total: number; page: number; limit: number; maxBatch: number };

export default async function DistributionPropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const raw = await searchParams;
  const filter: Record<string, string> = {};
  for (const k of FILTERS) { const v = raw[k]; if (typeof v === "string" && v) filter[k] = v; }
  if (!filter.statusGroup) filter.statusGroup = "CURRENT";
  const page = Math.max(1, Number(typeof raw.page === "string" ? raw.page : 1) || 1);

  const [list, dest] = await Promise.all([
    apiFetch<Listing>("/api/distribution/properties", { query: { ...filter, page, limit: 25 } }),
    apiFetch<{ data: Destination[] }>("/api/distribution/destinations"),
  ]);
  const v = (k: (typeof FILTERS)[number]) => filter[k] ?? "";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Διανομή ακινήτων</h1>
          <p className="muted">Βρείτε ακίνητα, επιλέξτε πολλά (ακόμη και σε πολλές σελίδες), ελέγξτε τι θα γίνει και ξεκινήστε μία μαζική ενέργεια. Τα ακίνητα διαχειρίζονται στα <Link href="/properties">Ακίνητα</Link>· η δημοσίευση στον ιστότοπο γίνεται ξεχωριστά, από κάθε ακίνητο.</p>
        </div>
      </div>
      <form method="get" className="filters" role="search">
        <input name="q" className="input" placeholder="Αναζήτηση: κωδικός, τίτλος, περιοχή" defaultValue={v("q")} aria-label="Αναζήτηση" />
        <input name="city" className="input" placeholder="Πόλη" defaultValue={v("city")} aria-label="Πόλη" />
        <select name="listingType" className="select" defaultValue={v("listingType")} aria-label="Συναλλαγή"><option value="">Πώληση και ενοικίαση</option><option value="SALE">Πώληση</option><option value="RENT">Ενοικίαση</option></select>
        <select name="statusGroup" className="select" defaultValue={v("statusGroup")} aria-label="Κατάσταση"><option value="CURRENT">Τρέχοντα</option><option value="PUBLIC">Στην αγορά</option></select>
        <select name="portalState" className="select" defaultValue={v("portalState")} aria-label="Κατάσταση portals"><option value="">Όλα</option><option value="NONE">Σε κανένα portal</option><option value="PUBLISHED">Δημοσιευμένα σε portal</option><option value="ISSUES">Με σφάλμα portal</option></select>
        <label className="pubchan__pick"><input type="checkbox" name="mine" value="1" defaultChecked={v("mine") === "1"} /> Δικά μου</label>
        <button className="btn btn--outline" type="submit">Φίλτρο</button>
      </form>
      {!list.ok ? (
        <div className="notice notice--danger">{list.error.message}</div>
      ) : list.data.data.length === 0 ? (
        <div className="empty">Κανένα ακίνητο για αυτά τα φίλτρα.</div>
      ) : (
        <DistributionWorkspace key={JSON.stringify(filter) + page} rows={list.data.data} total={list.data.total} page={list.data.page} limit={list.data.limit} maxBatch={list.data.maxBatch} filter={filter} destinations={dest.ok ? dest.data.data : []} />
      )}
    </>
  );
}
