import { toggleNotification } from "@/actions/settings";
import { apiFetch } from "@/lib/api";

type Data = {
  events: Array<{ value: string; label: string }>;
  channels: Array<{ value: string; label: string }>;
  enabled: Record<string, Record<string, boolean>>;
  available: Record<string, boolean>;
  canManage: boolean;
};

export async function NotificationsMatrix() {
  const result = await apiFetch<Data>("/api/settings/notifications");
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  const d = result.data;
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Συμβάντα και κανάλια</h2>
          <p className="panel__sub">
            {!d.available.EMAIL && "Το email ενεργοποιείται αφού ρυθμιστεί ο πάροχος email. "}
            {!d.available.SMS && "Το SMS ενεργοποιείται αφού ρυθμιστεί ο πάροχος SMS."}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data matrix">
          <thead>
            <tr>
              <th scope="col">Συμβάν</th>
              {d.channels.map((c) => <th key={c.value} scope="col" className="matrix__role">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.events.map((e) => (
              <tr key={e.value}>
                <th scope="row" className="matrix__perm">{e.label}</th>
                {d.channels.map((c) => {
                  const on = d.enabled[e.value]?.[c.value] ?? false;
                  const blocked = !on && !d.available[c.value];
                  const text = `${e.label} · ${c.label}: ${on ? "ενεργό" : "ανενεργό"}`;
                  return (
                    <td key={c.value} className="matrix__cell">
                      {!d.canManage || blocked ? (
                        <span className={on ? "mcell mcell--on" : "mcell"} role="img" aria-label={blocked ? `${text} (χρειάζεται πάροχος)` : text}>{on ? "✓" : "–"}</span>
                      ) : (
                        <form action={toggleNotification}>
                          <input type="hidden" name="event" value={e.value} />
                          <input type="hidden" name="channel" value={c.value} />
                          <input type="hidden" name="enabled" value={on ? "false" : "true"} />
                          <button type="submit" className={on ? "mcell mcell--on mcell--btn" : "mcell mcell--btn"} aria-label={`${text}. Αλλαγή`}>{on ? "✓" : "–"}</button>
                        </form>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
