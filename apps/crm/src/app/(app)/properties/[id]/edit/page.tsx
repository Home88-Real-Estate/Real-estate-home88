import Link from "next/link";
import { notFound } from "next/navigation";

import { saveProperty } from "@/actions/properties";
import { PropertyForm } from "@/components/PropertyForm";
import { apiFetch } from "@/lib/api";
import { requireRole } from "@/lib/session";

type PropertyDetail = { id: string; reference: string; titleEl: string };

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("AGENT");
  const { id } = await params;

  const result = await apiFetch<{ property: PropertyDetail; canEdit: boolean }>(
    `/api/properties/${id}`,
  );
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }

  const property = result.data.property;
  if (!result.data.canEdit) {
    return (
      <div className="notice notice--danger">
        Μόνο ο ανατεθειμένος σύμβουλος, ο δημιουργός ή ένας manager μπορεί να επεξεργαστεί αυτό το
        ακίνητο. <Link href={`/properties/${id}`}>Επιστροφή</Link>
      </div>
    );
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>
          Edit <span className="mono">{property.reference}</span>
        </h1>
        <Link href={`/properties/${id}`} className="btn btn--outline btn--sm">
          Back to property
        </Link>
      </div>

      <PropertyForm
        action={saveProperty}
        initial={property as unknown as Record<string, unknown>}
        submitLabel="Save changes"
      />
    </>
  );
}
