import { AREA_LEVELS } from "@home88/domain";

import { apiFetch } from "@/lib/api";

import { AreaCreateForm, AreaEditForm, type AreaRow } from "./AreaForms";

export async function AreasPanel() {
  const [areas, perms] = await Promise.all([
    apiFetch<{ data: AreaRow[]; portals: Array<{ code: string; name: string }> }>("/api/settings/areas"),
    apiFetch<{ sections: Array<{ key: string; canManage: boolean }> }>("/api/settings"),
  ]);
  if (!areas.ok) return <div className="notice notice--danger">{areas.error.message}</div>;
  const canManage = perms.ok && perms.data.sections.some((s) => s.key === "areas" && s.canManage);
  const all = areas.data.data;

  // Depth-first order, so each area sits under its parent.
  const ordered: Array<{ area: AreaRow; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of all.filter((x) => x.parentId === parentId)) {
      ordered.push({ area: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  const levelLabel = (l: string) => AREA_LEVELS.find((x) => x.value === l)?.label ?? l;

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Ιεραρχία περιοχών</h2>
          <p className="panel__sub">Περιφέρεια › Πόλη › Περιοχή › Γειτονιά. Οι κωδικοί των portals αποθηκεύονται εδώ, όχι μέσα στα ακίνητα.</p>
        </div>
      </div>
      {ordered.length === 0 ? (
        <p className="empty">Δεν έχουν καταχωριστεί περιοχές ακόμη. Η λίστα του Estate+ μπορεί να εισαχθεί στη Φάση 4.</p>
      ) : (
        <ul className="areatree">
          {ordered.map(({ area, depth }) => (
            <li key={area.id} style={{ paddingLeft: depth * 22 }}>
              <details>
                <summary>
                  <span className="areatree__name">{area.nameEl}</span>
                  {area.nameEn && <span className="muted"> · {area.nameEn}</span>}
                  <span className="badge badge--muted">{levelLabel(area.level)}</span>
                  {!area.active && <span className="badge badge--warn">Ανενεργή</span>}
                  {area.mappings.length > 0 && <span className="badge badge--info">{area.mappings.length} portal</span>}
                </summary>
                <AreaEditForm area={area} portals={areas.data.portals} canManage={canManage} />
              </details>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <details className="subpanel" open={ordered.length === 0}>
          <summary>Νέα περιοχή</summary>
          <AreaCreateForm areas={all} />
        </details>
      )}
    </div>
  );
}
