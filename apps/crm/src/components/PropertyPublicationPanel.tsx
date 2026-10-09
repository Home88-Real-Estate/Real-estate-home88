import { apiFetch } from "@/lib/api";
import { PublicationForm } from "@/components/PublicationForm";
import type { PublicationsPayload } from "@home88/domain";

/**
 * One panel for every channel a property can be published to: the HOME88 website
 * and the portals. Everything shown is calculated by the server.
 */
export async function PropertyPublicationPanel({ propertyId }: { propertyId: string }) {
  const res = await apiFetch<PublicationsPayload>(`/api/properties/${encodeURIComponent(propertyId)}/publications`);
  return (
    <div className="panel" id="publication">
      <div className="panel__head">
        <div>
          <h2>Δημοσίευση</h2>
          <p className="panel__sub">Κάθε κανάλι έχει δική του κατάσταση: ο ιστότοπος και τα portals δεν επηρεάζουν το ένα το άλλο. Τίποτα δεν δημοσιεύεται αυτόματα.</p>
        </div>
      </div>
      {!res.ok ? <div className="notice notice--danger">{res.error.message}</div> : <PublicationForm propertyId={propertyId} data={res.data} />}
    </div>
  );
}
