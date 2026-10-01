"use client";

/**
 * Consent banner.
 *
 * The defaults matter more than the buttons: every non-essential switch starts
 * OFF and "Reject all" is at least as prominent as "Accept all". Nothing is
 * loaded on the strength of scrolling, continued use, or a closed banner.
 *
 * The choice is written to a cookie that the server reads, so consent is stored
 * where the loader that depends on it can actually check it.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsentState } from "@/lib/consent";

const COOKIE = "h88_consent";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 6 months, then re-ask

function writeConsent(
  policyVersion: string,
  state: Omit<ConsentState, "version" | "necessary" | "decidedAt">,
): void {
  const payload = {
    // Must match COMPANY.policyVersion, or the server treats the choice as
    // stale and re-prompts. Reading it from the prop keeps the two in step.
    version: policyVersion,
    necessary: true,
    analytics: state.analytics,
    marketing: state.marketing,
    sessionReplay: state.sessionReplay,
    decidedAt: new Date().toISOString(),
  };
  document.cookie = [
    `${COOKIE}=${encodeURIComponent(JSON.stringify(payload))}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    window.location.protocol === "https:" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function ConsentBanner({ policyVersion }: { policyVersion: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [sessionReplay, setSessionReplay] = useState(false);

  const finish = useCallback(
    (choice: { analytics: boolean; marketing: boolean; sessionReplay: boolean }) => {
      writeConsent(policyVersion, choice);
      setOpen(false);
      // Re-render server components so anything gated on consent can load.
      router.refresh();
    },
    [router, policyVersion],
  );

  if (!open) return null;

  return (
    <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title">
      <div className="wrap consent__inner">
        <div style={{ flex: "1 1 420px" }}>
          <strong id="consent-title">Ρυθμίσεις απορρήτου</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Χρησιμοποιούμε μόνο τα απαραίτητα cookies για τη λειτουργία της ιστοσελίδας.
            Προαιρετικά cookies (στατιστικά, marketing) ενεργοποιούνται <strong>μόνο</strong> αν
            τα επιλέξετε. Μπορείτε να αλλάξετε την επιλογή σας οποιαδήποτε στιγμή από το
            υποσέλιδο.
          </p>

          {showDetail && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <label className="check">
                <input type="checkbox" checked disabled />
                <span>
                  <strong>Απαραίτητα</strong> — ασφάλεια φόρμας, προτιμήσεις γλώσσας, διαχείριση
                  συγκατάθεσης. Δεν μπορούν να απενεργοποιηθούν.
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
                <span>
                  <strong>Στατιστικά</strong> — ανώνυμη μέτρηση επισκέψεων για τη βελτίωση της
                  ιστοσελίδας. Απενεργοποιημένο εξ ορισμού.
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                />
                <span>
                  <strong>Marketing</strong> — μέτρηση καμπανιών και εξατομίκευση. Απενεργοποιημένο
                  εξ ορισμού.
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={sessionReplay}
                  onChange={(e) => setSessionReplay(e.target.checked)}
                />
                <span>
                  <strong>Καταγραφή συνεδρίας</strong> — δεν χρησιμοποιείται αυτή τη στιγμή. Ο
                  διακόπτης υπάρχει για πληρότητα και παραμένει κλειστός.
                </span>
              </label>
              <p className="muted" style={{ fontSize: "0.8rem" }}>
                Έκδοση πολιτικής: {policyVersion}
              </p>
            </div>
          )}
        </div>

        <div className="row" style={{ flex: "0 0 auto" }}>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => finish({ analytics: false, marketing: false, sessionReplay: false })}
          >
            Απόρριψη όλων
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
          >
            {showDetail ? "Απόκρυψη" : "Επιλογές"}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => finish({ analytics, marketing, sessionReplay })}
          >
            {showDetail ? "Αποθήκευση επιλογών" : "Αποδοχή όλων"}
          </button>
        </div>
      </div>
    </div>
  );
}
