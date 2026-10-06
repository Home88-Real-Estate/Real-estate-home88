import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ShowingForm } from "@/components/showings/ShowingForm";
import { apiFetch } from "@/lib/api";
import type { DirectoryUser } from "@/lib/contacts";
import { inputDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Επεξεργασία υπόδειξης" };

export default async function EditShowingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("AGENT");
  const { id } = await params;
  const [result, users] = await Promise.all([
    apiFetch<{ showing: { id: string; status: string; language: string; visitAt: string | null; comments: string | null; fee: { payer: string | null; method: string | null; basis: string | null; percentage: string | number | null; fixedAmount: string | number | null; currency: string | null; vatTreatment: string | null; vatRate: string | number | null; paymentTrigger: string | null }; parties: Array<{ idNumber: string | null; masked?: boolean }>; contact: { id: string; reference: string; firstName: string; lastName: string } | null; responsibleUser: { id: string } | null; properties: Array<{ propertyId: string | null; code: string; address: string | null; transactionType: string; propertyType: string | null; area: number | string | null; price: number | string | null }> } }>(`/api/showings/${encodeURIComponent(id)}`),
    apiFetch<{ data: DirectoryUser[] }>("/api/users/directory"),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const s = result.data.showing;
  if (s.status !== "DRAFT" && s.status !== "READY_FOR_ISSUANCE") redirect(`/showings/${id}`);
  const when = inputDateTime(s.visitAt);
  return (
    <>
      <h1>Επεξεργασία υπόδειξης</h1>
      <ShowingForm
        values={{
          id: s.id,
          contact: s.contact,
          properties: s.properties.filter((p) => p.propertyId).map((p) => ({ id: p.propertyId!, reference: p.code, titleEl: p.address ?? "", listingType: p.transactionType, propertyType: p.propertyType ?? "OTHER", city: null, areaName: p.address, area: p.area, price: p.price })),
          visitDate: when.date,
          visitTime: when.time,
          responsibleUserId: s.responsibleUser?.id ?? null,
          comments: s.comments,
          language: s.language,
          fee: s.fee,
          idNumber: s.parties[0]?.masked ? null : s.parties[0]?.idNumber ?? null,
          partyMasked: Boolean(s.parties[0]?.masked),
        }}
        users={users.ok ? users.data.data : []}
        currentUserId={user.id}
        canAssign={["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role)}
      />
    </>
  );
}
