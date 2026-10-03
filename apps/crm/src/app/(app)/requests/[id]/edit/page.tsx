import Link from "next/link";
import { notFound } from "next/navigation";

import { RequestForm } from "@/components/work/RequestForm";
import { apiFetch } from "@/lib/api";
import { requireRole } from "@/lib/session";

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const result = await apiFetch<{ request: Record<string, unknown> & { reference: string } }>(`/api/requests/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const r = result.data.request;
  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>
          Επεξεργασία <span className="mono">{r.reference}</span>
        </h1>
        <Link href={`/requests/${id}`} className="btn btn--outline btn--sm">
          Επιστροφή στη ζήτηση
        </Link>
      </div>
      <RequestForm initial={r as never} submitLabel="Αποθήκευση αλλαγών" />
    </>
  );
}
