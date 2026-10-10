"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { ActionButton } from "@/components/ui/ActionButton";
import { OfflineSyncAgent } from "@/lib/offline-runtime";
import { CRM_BASE_PATH } from "@/lib/paths";

import { OfflineWorkspace } from "./OfflineWorkspace";

/** The page the app shows when the CRM cannot be reached, and the list of drafts kept on this device. */
export function OfflinePage() {
  const [elsewhere, setElsewhere] = useState(false);
  const [startNew, setStartNew] = useState(false);
  useEffect(() => {
    // The service worker shows this page in place of one that could not load; the address is still that page's.
    setElsewhere(!window.location.pathname.replace(/\/$/, "").endsWith("/offline"));
    setStartNew(new URLSearchParams(window.location.search).get("new") === "1");
  }, []);

  return (
    <div className="offline-page xintake">
      <OfflineSyncAgent />
      <header className="offline-page__head">
        <a href={`${CRM_BASE_PATH}/`} aria-label="Αρχική CRM"><Logo width={112} /></a>
        <a className="xbtn xbtn--ghost xbtn--sm" href={`${CRM_BASE_PATH}/`}><Icon name="home" size={16} /><span>Αρχική CRM</span></a>
      </header>
      <h1>Καταχωρίσεις στη συσκευή</h1>
      {elsewhere && (
        <p className="xalert xalert--warn" role="status">
          <Icon name="cloudOff" size={18} />
          <span>Η σελίδα δεν μπορεί να φορτώσει χωρίς σύνδεση. Μπορείτε να καταχωρίσετε ένα ακίνητο εδώ· θα σταλεί στο CRM μόλις επανέλθει η σύνδεση.</span>
          <ActionButton variant="secondary" size="sm" onClick={() => window.location.reload()}>Δοκιμάστε ξανά</ActionButton>
        </p>
      )}
      <OfflineWorkspace startNew={startNew} />
    </div>
  );
}
