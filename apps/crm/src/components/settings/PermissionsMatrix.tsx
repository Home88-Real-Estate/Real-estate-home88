import { SETTINGS_SECTIONS } from "@home88/domain";

import { togglePermission } from "@/actions/settings";
import { apiFetch } from "@/lib/api";

type Matrix = {
  roles: string[];
  permissions: Array<{ code: string; label: string; group: string; reserved: boolean }>;
  grants: Record<string, string[]>;
  canManage: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Διαχειριστής",
  MANAGER: "Υπεύθυνος",
  AGENT: "Συνεργάτης",
  MARKETING: "Marketing",
  VIEWER: "Προβολή",
};

const ACTION_LABEL: Record<string, string> = { view: "Προβολή", manage: "Αλλαγή" };
const ACTION_SHORT: Record<string, string> = { view: "Π", manage: "Α" };

function Toggle({ role, code, label, has, locked }: { role: string; code: string; label: string; has: boolean; locked: boolean }) {
  const action = code.endsWith(".manage") ? "manage" : "view";
  const text = `${ROLE_LABEL[role] ?? role}, ${label}, ${ACTION_LABEL[action]}: ${has ? "επιτρέπεται" : "δεν επιτρέπεται"}`;
  const className = has ? "ptoggle ptoggle--on" : "ptoggle";
  if (locked) {
    return <span className={`${className} ptoggle--locked`} role="img" aria-label={text} title={ACTION_LABEL[action]}>{ACTION_SHORT[action]}</span>;
  }
  return (
    <form action={togglePermission}>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="permission" value={code} />
      <input type="hidden" name="granted" value={has ? "false" : "true"} />
      <button type="submit" className={className} aria-label={`${text}. Αλλαγή`} aria-pressed={has} title={`${ACTION_LABEL[action]}: ${has ? "επιτρέπεται" : "δεν επιτρέπεται"}`}>{ACTION_SHORT[action]}</button>
    </form>
  );
}

export async function PermissionsMatrix() {
  const result = await apiFetch<Matrix>("/api/settings/permissions");
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  const m = result.data;
  const reserved = new Set(m.permissions.filter((p) => p.reserved).map((p) => p.code));
  const rows = [
    ...SETTINGS_SECTIONS.map((s) => ({ key: s.key, label: s.title, group: s.navGroup, codes: [`settings.${s.key}.view`, `settings.${s.key}.manage`] })),
    { key: "audit", label: "Ιστορικό αλλαγών", group: "Σύστημα", codes: ["settings.audit.view"] },
  ];
  const groups: Array<[string, typeof rows]> = [];
  for (const r of rows) {
    const bucket = groups.find(([g]) => g === r.group);
    if (bucket) bucket[1].push(r);
    else groups.push([r.group, [r]]);
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Δικαιώματα ρυθμίσεων ανά ρόλο</h2>
          <p className="panel__sub">
            <strong>Π</strong> = Προβολή, <strong>Α</strong> = Αλλαγή· πράσινο σημαίνει ότι επιτρέπεται. Ο Super Admin έχει πάντα όλα τα δικαιώματα· η αλλαγή δικαιωμάτων, ασφάλειας και συνδρομής ανήκει μόνο σε
            αυτόν.{!m.canManage && " Βλέπετε τον πίνακα χωρίς δικαίωμα αλλαγής."}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data matrix">
          <thead>
            <tr>
              <th scope="col">Ενότητα</th>
              {m.roles.map((r) => <th key={r} scope="col" className="matrix__role">{ROLE_LABEL[r] ?? r}</th>)}
            </tr>
          </thead>
          {groups.map(([group, items]) => (
            <tbody key={group}>
              <tr className="matrix__group"><th colSpan={m.roles.length + 1} scope="colgroup">{group}</th></tr>
              {items.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="matrix__perm">{row.label}</th>
                  {m.roles.map((role) => (
                    <td key={role} className="matrix__cell">
                      <div className="ptoggles">
                        {row.codes.map((code) => (
                          <Toggle
                            key={code}
                            role={role}
                            code={code}
                            label={row.label}
                            has={(m.grants[role] ?? []).includes(code)}
                            locked={role === "SUPER_ADMIN" || reserved.has(code) || !m.canManage}
                          />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
