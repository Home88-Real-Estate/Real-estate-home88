"use client";

import { useActionState, useState } from "react";

import { portalOperation, type OperationState } from "@/actions/portal-accounts";
import { NO_ADAPTER_TEXT } from "@/lib/portal-ui";

export type PortalAccountChoice = { id: string; accountName: string; environment: "TEST" | "PRODUCTION"; status: string; enabled: boolean; providerKind: "mock" | "real" | "none" };

export type PortalActionRow = {
  code: string;
  state: string;
  hasAdapter: boolean;
  needsReview: boolean;
  portalAccountId: string | null;
  accounts: PortalAccountChoice[];
  outcome: string;
};

export type PortalPermissions = { preview: boolean; publish: boolean; update: boolean; unpublish: boolean; retry: boolean };

const LIVE = ["PUBLISHED", "OUTDATED", "IN_FEED"];

const OPS: Array<{ op: "preview" | "publish" | "update" | "unpublish" | "retry"; label: string; perm: keyof PortalPermissions }> = [
  { op: "preview", label: "Προεπισκόπηση", perm: "preview" },
  { op: "publish", label: "Δημοσίευση", perm: "publish" },
  { op: "update", label: "Ενημέρωση", perm: "update" },
  { op: "unpublish", label: "Απόσυρση", perm: "unpublish" },
  { op: "retry", label: "Επανάληψη", perm: "retry" },
];

/** Which operations make sense for the listing's current state; the server enforces the same rules. */
function applicable(op: string, state: string): boolean {
  if (op === "preview") return true;
  if (op === "publish") return !LIVE.includes(state) && state !== "FAILED";
  if (op === "update" || op === "unpublish") return LIVE.includes(state);
  return state === "FAILED"; // retry
}

export function PropertyPortalActions({ propertyId, row, permissions }: { propertyId: string; row: PortalActionRow; permissions: PortalPermissions }) {
  const usable = row.accounts.filter((a) => a.providerKind !== "none");
  const initial = row.accounts.find((a) => a.id === row.portalAccountId)?.id ?? usable.find((a) => a.enabled)?.id ?? usable[0]?.id ?? "";
  const [accountId, setAccountId] = useState(initial);
  const [state, action, pending] = useActionState<OperationState, FormData>(portalOperation, { ok: false });
  const account = row.accounts.find((a) => a.id === accountId);

  if (!row.hasAdapter) return <p className="hint">{NO_ADAPTER_TEXT}</p>;
  if (row.accounts.length === 0) return <p className="hint">Δεν έχει ρυθμιστεί λογαριασμός για αυτό το portal.</p>;
  if (usable.length === 0) return <p className="hint">Δεν υπάρχει διαθέσιμος πάροχος: {NO_ADAPTER_TEXT.toLowerCase()}</p>;

  return (
    <form action={action} className="portalops">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="code" value={row.code} />
      <input type="hidden" name="environment" value={account?.environment ?? ""} />
      <div className="portalops__row">
        <label className="sr-only" htmlFor={`acct-${row.code}`}>Λογαριασμός</label>
        <select id={`acct-${row.code}`} name="accountId" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountName} · {a.environment}
              {a.providerKind === "mock" ? " · mock" : ""}
              {a.enabled ? "" : " · ανενεργός"}
            </option>
          ))}
        </select>
      </div>
      <div className="portalops__buttons">
        {OPS.filter((o) => permissions[o.perm] && applicable(o.op, row.state)).map((o) => (
          <button key={o.op} type="submit" name="op" value={o.op} className={o.op === "publish" ? "btn btn--primary btn--sm" : "btn btn--outline btn--sm"} disabled={pending || (o.op !== "preview" && account?.enabled === false)}>
            {o.label}
          </button>
        ))}
      </div>
      {account && account.providerKind === "mock" && <p className="hint">Λογαριασμός TEST με mock πάροχο: δεν γίνεται επικοινωνία με πραγματικό portal.</p>}
      {account && !account.enabled && <p className="hint">Ο λογαριασμός δεν είναι ενεργός· μόνο προεπισκόπηση.</p>}
      {state.message && <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role={state.ok ? "status" : "alert"}>{state.message}</div>}
      {state.preview && (
        <details open className="portalops__preview">
          <summary>
            Προεπισκόπηση · {state.preview.outcome === "READY" ? "έτοιμο" : "δεν θα στελνόταν"} · {state.preview.mediaCount} φωτογραφίες
          </summary>
          {state.preview.reasons.length > 0 && <ul>{state.preview.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {state.preview.providerErrors.length > 0 && <ul>{state.preview.providerErrors.map((r) => <li key={r}>{r}</li>)}</ul>}
          {state.preview.warnings.length > 0 && <p className="hint">Προειδοποιήσεις: {state.preview.warnings.join(" · ")}</p>}
          <p className="hint mono">ID {state.preview.externalId} · hash {state.preview.hash.slice(0, 12)}</p>
          <pre className="portalops__body">{state.preview.body}</pre>
        </details>
      )}
    </form>
  );
}
