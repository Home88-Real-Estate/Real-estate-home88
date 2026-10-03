import Link from "next/link";
import { settingsSection } from "@home88/domain";

import { getSettingsOverview } from "@/lib/settings";

export default async function SettingsOverviewPage() {
  const result = await getSettingsOverview();
  if (!result.ok) return null;
  const { sections, missingPublicFields } = result.data;
  const groups: Array<[string, typeof sections]> = [];
  for (const s of sections) {
    const bucket = groups.find(([g]) => g === s.navGroup);
    if (bucket) bucket[1].push(s);
    else groups.push([s.navGroup, [s]]);
  }

  return (
    <>
      {missingPublicFields.length > 0 && (
        <div className="notice notice--warn" role="status">
          <strong>Ο ιστότοπος περιμένει στοιχεία.</strong> Μέχρι να συμπληρωθούν, τα αντίστοιχα σημεία δεν εμφανίζονται στο
          site (δεν μπαίνουν προσωρινά ή ψεύτικα στοιχεία):{" "}
          {missingPublicFields.map((f, i) => (
            <span key={`${f.section}.${f.key}`}>
              {i > 0 && ", "}
              <Link href={`/settings/${f.section}`}>{f.label}</Link>
            </span>
          ))}
          .
        </div>
      )}
      {groups.map(([group, items]) => (
        <section key={group} className="settings__cards" aria-label={group}>
          <h2>{group}</h2>
          <div className="scards">
            {items.map((s) => {
              const def = settingsSection(s.key);
              return (
                <Link key={s.key} href={`/settings/${s.key}`} className="scard">
                  <span className="scard__title">{s.title}</span>
                  <span className="scard__text">{def?.description}</span>
                  {!s.canManage && <span className="badge badge--muted">Μόνο προβολή</span>}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
