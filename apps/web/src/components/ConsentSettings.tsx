"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Choices = { analytics: boolean; marketing: boolean; sessionReplay: boolean };

const COOKIE = "h88_consent";
const ONE_YEAR = 60 * 60 * 24 * 365;

function writeConsent(policyVersion: string, choices: Choices) {
  const value = encodeURIComponent(
    JSON.stringify({
      version: policyVersion,
      necessary: true,
      analytics: choices.analytics,
      marketing: choices.marketing,
      sessionReplay: choices.sessionReplay,
      decidedAt: new Date().toISOString(),
    }),
  );
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
}

export function ConsentSettings({
  policyVersion,
  initial,
}: {
  policyVersion: string;
  initial: Choices;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Choices>(initial);
  const [saved, setSaved] = useState(false);

  function toggle(purpose: keyof Choices) {
    setChoices((c) => ({ ...c, [purpose]: !c[purpose] }));
    setSaved(false);
  }

  function save(next: Choices) {
    writeConsent(policyVersion, next);
    setChoices(next);
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      <div className="notice">
        <strong>Απολύτως απαραίτητα</strong>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
          Πάντα ενεργά. Χωρίς αυτά δεν λειτουργεί η ιστοσελίδα και η αποθήκευση της επιλογής σας.
        </p>
      </div>

      <label className="check" style={{ marginTop: 16 }}>
        <input type="checkbox" checked={choices.analytics} onChange={() => toggle("analytics")} />
        <span>
          <strong>Στατιστικά</strong> — ανώνυμη μέτρηση επισκέψεων.{" "}
          <em className="muted">Προαιρετικό.</em>
        </span>
      </label>

      <label className="check">
        <input type="checkbox" checked={choices.marketing} onChange={() => toggle("marketing")} />
        <span>
          <strong>Marketing</strong> — ενημερώσεις για νέα ακίνητα και προσφορές.{" "}
          <em className="muted">Προαιρετικό.</em>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={choices.sessionReplay}
          onChange={() => toggle("sessionReplay")}
        />
        <span>
          <strong>Καταγραφή συνεδρίας</strong> —{" "}
          <em className="muted">
            δεν χρησιμοποιείται σε αυτή την ιστοσελίδα· η επιλογή υπάρχει για διαφάνεια και
            παραμένει ανενεργή.
          </em>
        </span>
      </label>

      {saved && (
        <div className="notice" role="status" style={{ marginTop: 14 }}>
          Οι προτιμήσεις σας αποθηκεύτηκαν.
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => save(choices)}
        >
          Αποθήκευση επιλογών
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => save({ analytics: false, marketing: false, sessionReplay: false })}
        >
          Απόρριψη όλων
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => save({ analytics: true, marketing: true, sessionReplay: false })}
        >
          Αποδοχή όλων
        </button>
      </div>
    </div>
  );
}
