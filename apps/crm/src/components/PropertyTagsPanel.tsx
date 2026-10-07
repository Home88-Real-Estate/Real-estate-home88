import { PropertyTagsForm } from "@/components/PropertyTagsForm";
import { apiFetch } from "@/lib/api";

/**
 * Internal tags of one property. They are shown in the main property list, so the
 * selector sits in the property file itself rather than inside the portal panel.
 */
export async function PropertyTagsPanel({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const tags = await apiFetch<{ codes: string[]; available: Array<{ code: string; labelEl: string }> }>(
    `/api/properties/${encodeURIComponent(propertyId)}/tags`,
  );
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Ετικέτες</h2>
          <p className="panel__sub">Επιλέξτε ό,τι ισχύει για το ακίνητο. Εμφανίζονται και στη λίστα «Ακίνητα».</p>
        </div>
      </div>
      {!tags.ok ? (
        <div className="notice notice--danger">{tags.error.message}</div>
      ) : (
        <PropertyTagsForm propertyId={propertyId} selected={tags.data.codes} available={tags.data.available} canEdit={canManage} />
      )}
    </div>
  );
}
