import { apiFetch } from "@/lib/api";

import { TagCreateForm, TagRowForm, type Tag } from "./TagForms";

export async function TagsPanel() {
  const [tags, view] = await Promise.all([
    apiFetch<{ data: Tag[] }>("/api/settings/property-tags"),
    apiFetch<{ canManage: boolean }>("/api/settings/sections/properties"),
  ]);
  if (!tags.ok) return <div className="notice notice--danger">{tags.error.message}</div>;
  const canManage = view.ok && view.data.canManage;
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Εσωτερικές ετικέτες ακινήτων</h2>
          <p className="panel__sub">
            Σταθεροί κωδικοί με ελληνική ετικέτα, στη θέση των ελεύθερων κατηγοριών του Estate+. Δεν εμφανίζονται ποτέ στο κοινό.
            Οι κωδικοί δεν αλλάζουν, γιατί σε αυτούς βασίζονται αναφορές και κανόνες.
          </p>
        </div>
      </div>
      <div className="taglist">
        {tags.data.data.map((t) => <TagRowForm key={t.id} tag={t} canManage={canManage} />)}
      </div>
      {canManage && (
        <details className="subpanel">
          <summary>Νέα ετικέτα</summary>
          <TagCreateForm />
        </details>
      )}
    </div>
  );
}
