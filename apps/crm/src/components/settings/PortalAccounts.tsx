"use client";

import { useActionState } from "react";

import { createPortalAccount, saveAccountCredentials, setAccountEnabled, setAccountMockMode, testAccountConnection } from "@/actions/portal-accounts";
import { formatDateTime } from "@/lib/format";
import { idleState } from "@/lib/form";
import { ACCOUNT_STATUS_LABEL, MOCK_MODE_LABEL } from "@/lib/portal-ui";

export type AccountRow = {
  id: string;
  portalCode: string;
  accountName: string;
  agencyExternalId: string | null;
  endpointUrl: string | null;
  environment: "TEST" | "PRODUCTION";
  status: string;
  enabled: boolean;
  providerKind: "mock" | "real" | "none";
  credentials: Record<string, { label: string; configured: boolean; masked: string | null; changedAt: string | null }>;
  credentialRotatedAt: string | null;
  lastConnectionTestAt: string | null;
  lastConnectionTestStatus: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  mockMode?: string | null;
};

export type AccountPermissions = { configure: boolean; manage_credentials: boolean; test_connection: boolean; activate_production: boolean };

function Notice({ state }: { state: { ok: boolean; message?: string } }) {
  return state.message ? <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role={state.ok ? "status" : "alert"}>{state.message}</div> : null;
}

function CredentialsForm({ account, code, can }: { account: AccountRow; code: string; can: boolean }) {
  const [state, action, pending] = useActionState(saveAccountCredentials, idleState);
  return (
    <form action={action} className="sform">
      <input type="hidden" name="id" value={account.id} />
      <input type="hidden" name="code" value={code} />
      <Notice state={state} />
      <div className="formgrid">
        {Object.entries(account.credentials).map(([key, c]) => (
          <div key={key} className="field">
            <label htmlFor={`${account.id}-${key}`}>{c.label}</label>
            <div className="secret__state">
              {c.configured ? (
                <span className="badge badge--ok">Έχει ρυθμιστεί</span>
              ) : (
                <span className="badge badge--muted">Δεν έχει ρυθμιστεί</span>
              )}
              {c.configured && (
                <span className="hint mono">
                  {" "}
                  {c.masked} · άλλαξε {c.changedAt ? formatDateTime(c.changedAt) : "—"}
                </span>
              )}
            </div>
            {can && (
              <>
                <input id={`${account.id}-${key}`} name={`secret.${key}`} type="password" className="input" autoComplete="new-password" placeholder={c.configured ? "Νέα τιμή (κενό = διατήρηση)" : "Τιμή"} />
                {c.configured && <label className="check"><input type="checkbox" name={`clear.${key}`} /> Αφαίρεση</label>}
              </>
            )}
          </div>
        ))}
      </div>
      {can && (
        <div className="sform__footer">
          <span className="hint">Οι τιμές κρυπτογραφούνται στον server και δεν εμφανίζονται ξανά.</span>
          <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>{pending ? "Αποθήκευση…" : "Αποθήκευση διαπιστευτηρίων"}</button>
        </div>
      )}
    </form>
  );
}

function AccountActions({ account, code, can }: { account: AccountRow; code: string; can: AccountPermissions }) {
  const [testState, test, testing] = useActionState(testAccountConnection, idleState);
  const [enableState, enable, enabling] = useActionState(setAccountEnabled, idleState);
  const [mockState, mock, mocking] = useActionState(setAccountMockMode, idleState);
  const prodLocked = account.environment === "PRODUCTION" && !can.activate_production;
  return (
    <div className="portalaccount__actions">
      <Notice state={testState} />
      <Notice state={enableState} />
      <Notice state={mockState} />
      <div className="portalops__buttons">
        {can.test_connection && (
          <form action={test}>
            <input type="hidden" name="id" value={account.id} />
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="environment" value={account.environment} />
            <button type="submit" className="btn btn--outline btn--sm" disabled={testing || account.providerKind === "none"}>{testing ? "Έλεγχος…" : "Έλεγχος σύνδεσης"}</button>
          </form>
        )}
        {can.configure && !prodLocked && (
          <form action={enable}>
            <input type="hidden" name="id" value={account.id} />
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="enabled" value={account.enabled ? "0" : "1"} />
            <button type="submit" className="btn btn--outline btn--sm" disabled={enabling || account.providerKind === "none"}>{account.enabled ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button>
          </form>
        )}
      </div>
      {account.providerKind === "none" && <p className="hint">Δεν υπάρχει ακόμη adapter για αυτό το περιβάλλον· ο λογαριασμός δεν μπορεί να ελεγχθεί ή να ενεργοποιηθεί.</p>}
      {account.environment === "TEST" && account.providerKind === "mock" && can.configure && (
        <form action={mock} className="portalops__row">
          <input type="hidden" name="id" value={account.id} />
          <input type="hidden" name="code" value={code} />
          <label htmlFor={`mm-${account.id}`} className="hint">Συμπεριφορά mock</label>
          <select id={`mm-${account.id}`} name="mockMode" className="select" defaultValue={account.mockMode ?? "success"}>
            {Object.entries(MOCK_MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="submit" className="btn btn--ghost btn--sm" disabled={mocking}>Εφαρμογή</button>
        </form>
      )}
    </div>
  );
}

function NewAccountForm({ code, can }: { code: string; can: AccountPermissions }) {
  const [state, action, pending] = useActionState(createPortalAccount, idleState);
  return (
    <form action={action} className="sform">
      <input type="hidden" name="code" value={code} />
      <Notice state={state} />
      <div className="formgrid">
        <div className="field">
          <label htmlFor="pa-name">Όνομα λογαριασμού</label>
          <input id="pa-name" name="accountName" className="input" required minLength={2} maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="pa-env">Περιβάλλον</label>
          <select id="pa-env" name="environment" className="select" required defaultValue="">
            <option value="" disabled>Επιλέξτε…</option>
            <option value="TEST">TEST (δοκιμαστικό)</option>
            {can.activate_production && <option value="PRODUCTION">PRODUCTION (παραγωγή)</option>}
          </select>
          <span className="hint">Το περιβάλλον επιλέγεται πάντα ρητά και δεν αλλάζει αργότερα.</span>
        </div>
        <div className="field">
          <label htmlFor="pa-agency">Agency / account ID</label>
          <input id="pa-agency" name="agencyExternalId" className="input" maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="pa-endpoint">Endpoint (https, προαιρετικά)</label>
          <input id="pa-endpoint" name="endpointUrl" type="url" className="input" maxLength={300} />
        </div>
      </div>
      <div className="sform__footer">
        <span />
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>{pending ? "Δημιουργία…" : "Νέος λογαριασμός"}</button>
      </div>
    </form>
  );
}

export function PortalAccounts({ code, accounts, can }: { code: string; accounts: AccountRow[]; can: AccountPermissions }) {
  return (
    <div className="portalaccounts">
      {accounts.length === 0 && <p className="hint">Δεν υπάρχει λογαριασμός για αυτό το portal ακόμη.</p>}
      {accounts.map((a) => (
        <section key={a.id} className="portalaccount" aria-label={`${a.accountName} ${a.environment}`}>
          <header className="portalaccount__head">
            <h3>{a.accountName}</h3>
            <span className={a.environment === "PRODUCTION" ? "badge badge--danger" : "badge badge--info"}>{a.environment}</span>
            <span className={a.status === "ACTIVE" ? "badge badge--ok" : a.status === "ERROR" ? "badge badge--danger" : "badge badge--muted"}>{ACCOUNT_STATUS_LABEL[a.status] ?? a.status}</span>
            {a.providerKind === "mock" && <span className="badge badge--muted">mock</span>}
          </header>
          <dl className="portalaccount__meta">
            {a.agencyExternalId && (<><dt>Agency ID</dt><dd className="mono">{a.agencyExternalId}</dd></>)}
            <dt>Τελευταίος έλεγχος σύνδεσης</dt>
            <dd>{a.lastConnectionTestAt ? `${formatDateTime(a.lastConnectionTestAt)} · ${a.lastConnectionTestStatus === "OK" ? "επιτυχής" : "αποτυχημένος"}` : "—"}</dd>
            <dt>Τελευταίος επιτυχής συγχρονισμός</dt>
            <dd>{a.lastSuccessfulSyncAt ? formatDateTime(a.lastSuccessfulSyncAt) : "—"}</dd>
            <dt>Αλλαγή διαπιστευτηρίων</dt>
            <dd>{a.credentialRotatedAt ? formatDateTime(a.credentialRotatedAt) : "—"}</dd>
          </dl>
          {a.lastErrorMessage && <p className="notice notice--danger">Τελευταίο σφάλμα{a.lastErrorCode ? ` (${a.lastErrorCode})` : ""}: {a.lastErrorMessage}</p>}
          <CredentialsForm account={a} code={code} can={can.manage_credentials && (a.environment === "TEST" || can.activate_production)} />
          <AccountActions account={a} code={code} can={can} />
        </section>
      ))}
      {can.configure && <NewAccountForm code={code} can={can} />}
    </div>
  );
}
