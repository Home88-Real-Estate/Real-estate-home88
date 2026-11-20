import type { Metadata } from "next";

import { ImportWorkspace, type ImportBatch } from "@/components/imports/ImportWorkspace";
import { apiFetch } from "@/lib/api";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Εισαγωγή δεδομένων" };

export default async function ImportsPage() {
  await requireRole("MANAGER");
  const result = await apiFetch<{ data: ImportBatch[]; pagination: { total: number } }>("/api/legacy-imports", {
    query: { page: 1, limit: 100 },
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Εισαγωγή δεδομένων</h1>
          <p className="muted">Ελεγχόμενη μεταφορά αρχείων σε ασφαλή χώρο ελέγχου πριν από οποιαδήποτε καταχώριση στο HOME88.</p>
        </div>
      </header>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : (
        <ImportWorkspace initialBatches={result.data.data} />
      )}
    </>
  );
}
