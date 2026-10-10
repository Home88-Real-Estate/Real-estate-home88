"use client";

import { useEffect, useState } from "react";
import { PROPERTY_TYPE_LABELS } from "@home88/types";

import { Icon } from "@/components/Icon";
import { ActionButton } from "@/components/ui/ActionButton";
import { draftState, emptyDraft, offlineStore, STATE_LABEL, type OfflineDraft } from "@/lib/offline-store";
import { localPhotoKey } from "@/lib/offline-sync";
import { fieldName, notifyOffline, offlineSync, useOfflineQueue } from "@/lib/offline-runtime";
import { CRM_BASE_PATH } from "@/lib/paths";
import { photoStore } from "@/lib/pending-photos";

import { OfflineDraftEditor } from "./OfflineDraftEditor";

function titleOf(d: OfflineDraft): string {
  const type = PROPERTY_TYPE_LABELS[String(d.fields.propertyType ?? "")]?.el;
  const place = d.fields.areaName ?? d.fields.city;
  return [type, place].filter(Boolean).join(" · ") || "Νέο ακίνητο";
}

/**
 * Drafts kept on this device and their way to the CRM: what is saved here, what waits, what the server
 * confirmed, and anything that needs the agent (a conflict, a value refused, a draft to finish in the CRM).
 */
export function OfflineWorkspace({ startNew = false }: { startNew?: boolean }) {
  const queue = useOfflineQueue();
  const [editing, setEditing] = useState<OfflineDraft | null>(null);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (startNew) setEditing(emptyDraft());
  }, [startNew]);
  useEffect(() => {
    void photoStore.counts().then(setPhotoCounts);
  }, [queue.drafts, queue.ops]);

  const waitingOps = queue.ops.filter((o) => o.status !== "done").length;
  const crm = (path: string) => `${CRM_BASE_PATH}${path}`;

  async function discard(d: OfflineDraft) {
    const state = draftState(d, queue.ops, queue.online);
    if (state !== "synced" && !window.confirm("Η καταχώριση δεν έχει φτάσει ολόκληρη στο CRM. Να διαγραφεί από τη συσκευή μαζί με τις φωτογραφίες της;")) return;
    await offlineStore.remove(d.localId);
    await photoStore.clear(d.sessionId ?? localPhotoKey(d.localId));
    if (d.sessionId) await photoStore.clear(localPhotoKey(d.localId));
    notifyOffline();
  }

  if (editing) {
    return (
      <OfflineDraftEditor
        initial={editing}
        online={queue.online}
        onDone={(saved) => {
          setEditing(null);
          if (saved && queue.online) void offlineSync.sync();
        }}
      />
    );
  }

  return (
    <div className="offline">
      <div className="offline-head">
        <span className={queue.online ? "xpill xpill--ok" : "xpill xpill--warn"}>
          <Icon name={queue.online ? "check" : "cloudOff"} size={14} /> {queue.online ? "Συνδεδεμένο" : "Εκτός σύνδεσης"}
        </span>
        <p className="offline-summary" role="status" aria-live="polite">
          {queue.drafts.length === 0
            ? "Δεν υπάρχουν καταχωρίσεις σε αυτή τη συσκευή."
            : waitingOps > 0
              ? <><strong>Αποθηκεύτηκε στη συσκευή</strong> · {waitingOps} {waitingOps === 1 ? "ενέργεια εκκρεμεί" : "ενέργειες εκκρεμούν"}</>
              : <><strong>Όλα συγχρονίστηκαν</strong> · το CRM επιβεβαίωσε κάθε αλλαγή</>}
        </p>
        <span className="offline-head__actions">
          <ActionButton variant="secondary" icon="wave" loading={queue.syncing} loadingLabel="Συγχρονισμός…" disabled={!queue.online || waitingOps === 0} onClick={() => void queue.syncNow()} title={queue.online ? undefined : "Χρειάζεται σύνδεση"}>
            Συγχρονισμός τώρα
          </ActionButton>
          <ActionButton variant="primary" icon="plus" onClick={() => setEditing(emptyDraft())}>Νέα καταχώριση στη συσκευή</ActionButton>
        </span>
      </div>
      {queue.last?.stopped === "auth" && (
        <p className="xalert xalert--warn" role="alert"><Icon name="alert" size={18} /><span>Η σύνδεσή σας στο CRM έληξε. <a href={crm("/login")}>Συνδεθείτε ξανά</a> και ο συγχρονισμός θα συνεχίσει· τίποτα δεν χάθηκε από τη συσκευή.</span></p>
      )}

      <ul className="offline-list">
        {queue.drafts.map((d) => {
          const state = draftState(d, queue.ops, queue.online);
          const ops = queue.ops.filter((o) => o.localId === d.localId);
          const open = ops.filter((o) => o.status !== "done");
          const problem = ops.find((o) => (o.status === "failed" || o.status === "pending") && o.lastError)?.lastError;
          const photos = (photoCounts[d.sessionId ?? ""] ?? 0) + (photoCounts[localPhotoKey(d.localId)] ?? 0);
          return (
            <li key={d.localId} className={`xcard offline-item offline-item--${state}`}>
              <div className="offline-item__head">
                <strong>{titleOf(d)}</strong>
                <span className={`offline-state offline-state--${state}`}>{STATE_LABEL[state]}</span>
              </div>
              <p className="hint">
                {Object.keys(d.fields).length} στοιχεία{photos > 0 ? ` · ${photos} φωτογραφίες στη συσκευή` : ""}{d.location ? " · με θέση" : ""}
                {open.length > 0 ? ` · ${open.length} ${open.length === 1 ? "ενέργεια εκκρεμεί" : "ενέργειες εκκρεμούν"}` : ""}
                {d.lastSyncedAt ? ` · τελευταίος συγχρονισμός ${new Date(d.lastSyncedAt).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </p>
              {d.message && <p className="offline-item__msg">{d.message}</p>}
              {problem && state !== "synced" && <p className="offline-item__msg offline-item__msg--warn">{problem}</p>}
              {d.conflicts.length > 0 && (
                <div className="offline-conflicts" role="group" aria-label="Συγκρούσεις">
                  <p><strong>Άλλαξαν στο CRM όσο ήσασταν εκτός σύνδεσης:</strong></p>
                  {d.conflicts.map((c) => (
                    <div key={c.key} className="offline-conflict">
                      <span>{c.label || fieldName(c.key)}: εσείς <strong>{c.mine ?? "κενό"}</strong> · CRM <strong>{c.server ?? "κενό"}</strong></span>
                      <span className="offline-conflict__buttons">
                        <ActionButton variant="secondary" size="sm" onClick={() => void offlineSync.resolve(d.localId, c.key, "mine")}>Κράτησε τη δική μου</ActionButton>
                        <ActionButton variant="ghost" size="sm" onClick={() => void offlineSync.resolve(d.localId, c.key, "server")}>Κράτησε του CRM</ActionButton>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="offline-item__actions">
                <ActionButton variant="secondary" size="sm" icon="keyboard" onClick={() => setEditing(d)}>Επεξεργασία</ActionButton>
                {d.propertyId && queue.online && <a className="xbtn xbtn--ghost xbtn--sm" href={crm(`/properties/${d.propertyId}`)}><Icon name="building" size={16} /><span>{d.reference ? `Ακίνητο ${d.reference}` : "Καρτέλα ακινήτου"}</span></a>}
                {!d.propertyId && d.sessionId && queue.online && <a className="xbtn xbtn--ghost xbtn--sm" href={crm(`/properties/new/assistant?session=${encodeURIComponent(d.sessionId)}`)}><Icon name="mic" size={16} /><span>Άνοιγμα στο CRM</span></a>}
                <ActionButton variant="ghost" size="sm" onClick={() => void discard(d)}>{state === "synced" ? "Απόκρυψη" : "Διαγραφή από τη συσκευή"}</ActionButton>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hint">Οι καταχωρίσεις μένουν μόνο σε αυτή τη συσκευή μέχρι να συγχρονιστούν, και διαγράφονται από αυτήν με την αποσύνδεση. Ο συγχρονισμός γίνεται όταν μια σελίδα του CRM είναι ανοιχτή· δεν τρέχει στο παρασκήνιο με κλειστό browser.</p>
    </div>
  );
}

/** One line for the dashboard and the assistant: shown only when this device holds drafts. */
export function SyncStatus() {
  const queue = useOfflineQueue();
  if (!queue.loaded || queue.drafts.length === 0) return null;
  const waiting = queue.ops.filter((o) => o.status !== "done").length;
  const attention = queue.drafts.filter((d) => ["conflict", "review"].includes(draftState(d, queue.ops, queue.online))).length;
  return (
    <div className="sync">
      <Icon name={queue.online ? "wave" : "cloudOff"} size={18} />
      <span>
        <strong>Στη συσκευή:</strong> {queue.drafts.length} {queue.drafts.length === 1 ? "καταχώριση" : "καταχωρίσεις"}
        {waiting > 0 ? ` · ${waiting} ${waiting === 1 ? "ενέργεια εκκρεμεί" : "ενέργειες εκκρεμούν"}` : " · συγχρονισμένες"}
        {attention > 0 ? ` · ${attention} χρειάζονται έλεγχο` : ""}
      </span>
      <span className="sync__actions">
        {waiting > 0 && <ActionButton variant="secondary" size="sm" loading={queue.syncing} loadingLabel="Συγχρονισμός…" disabled={!queue.online} onClick={() => void queue.syncNow()}>Συγχρονισμός τώρα</ActionButton>}
        <a className="xbtn xbtn--ghost xbtn--sm" href={`${CRM_BASE_PATH}/offline`}><span>Προβολή</span></a>
      </span>
    </div>
  );
}
