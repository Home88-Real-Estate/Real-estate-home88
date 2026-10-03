import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { SubmissionActions } from "@/components/SubmissionActions";
import { apiFetch } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { MEDIA_LIFECYCLE_LABEL, SUBMISSION_STATUS_CLASS, SUBMISSION_STATUS_LABEL } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Υποβολή ιδιοκτήτη" };

type Photo = { id: string; lifecycle: string; status: string; note: string | null; width: number | null; height: number | null; byteSize: number; fileName: string | null; attached: boolean };
type Detail = {
  id: string;
  reference: string;
  kind: string;
  status: string;
  titleEl: string;
  descriptionEl: string;
  listingType: string;
  propertyType: string;
  price: number | null;
  area: number | null;
  bedrooms: number | null;
  city: string | null;
  neighborhood: string | null;
  reviewNotes: string | null;
  rejectedReason: string | null;
  propertyId: string | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: string;
  lead: { reference: string; type: string; sourceChannel: string | null; landingPage: string | null; referrerHost: string | null } | null;
  contact: { id: string; reference: string; name: string; email: string | null; phone: string | null } | null;
  photos: Photo[];
  documents: Array<{ id: string; title: string; lifecycle: string; mimeType: string; byteSize: number; note: string | null }>;
  documentsHidden: boolean;
};

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("AGENT");
  const { id } = await params;
  const result = await apiFetch<{ submission: Detail }>(`/api/submissions/${encodeURIComponent(id)}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const s = result.data.submission;

  // Short-lived signed thumbnails, minted per request; nothing permanent is ever put in the page.
  const thumbs = await Promise.all(
    s.photos.filter((p) => p.lifecycle === "AVAILABLE").slice(0, 40).map(async (p) => {
      const r = await apiFetch<{ url: string }>(`/api/submissions/${id}/photos/${p.id}/url`, { query: { variant: "thumbnail" } });
      return [p.id, r.ok ? r.data.url : null] as const;
    }),
  );
  const thumbOf = new Map(thumbs);
  const convertible = !s.propertyId && !["REJECTED", "ARCHIVED"].includes(s.status);

  return (
    <>
      <p><Link href="/submissions">‹ Αναθέσεις</Link></p>
      <div className="page-head">
        <div>
          <h1>
            {s.reference} <span className={SUBMISSION_STATUS_CLASS[s.status] ?? "badge"}>{SUBMISSION_STATUS_LABEL[s.status] ?? s.status}</span>
          </h1>
          <p className="muted">
            {s.kind === "VALUATION" ? "Αίτημα εκτίμησης" : "Ανάθεση ακινήτου"} · {formatDateTime(s.createdAt)}
            {s.lead?.landingPage ? ` · από ${s.lead.landingPage}` : ""}
            {s.lead?.sourceChannel ? ` · ${s.lead.sourceChannel}` : ""}
          </p>
        </div>
        {s.propertyId && <Link href={`/properties/${s.propertyId}`} className="btn btn--primary">Άνοιγμα ακινήτου</Link>}
      </div>

      <div className="grid grid--2" style={{ alignItems: "start" }}>
        <div className="panel">
          <h2>Ιδιοκτήτης</h2>
          {s.contact ? (
            <dl className="dl">
              <dt>Όνομα</dt><dd><Link href={`/contacts/${s.contact.id}`}>{s.contact.name}</Link> <span className="mono muted">{s.contact.reference}</span></dd>
              <dt>Email</dt><dd>{s.contact.email ?? "—"}</dd>
              <dt>Τηλέφωνο</dt><dd>{s.contact.phone ?? "—"}</dd>
            </dl>
          ) : <p className="muted">Δεν υπάρχει συνδεδεμένη επαφή.</p>}
          <h2 style={{ marginTop: 20 }}>Ακίνητο όπως το περιέγραψε</h2>
          <dl className="dl">
            <dt>Τίτλος</dt><dd>{s.titleEl}</dd>
            <dt>Είδος</dt><dd>{label(LISTING_TYPE_LABELS, s.listingType, "el")} · {label(PROPERTY_TYPE_LABELS, s.propertyType, "el")}</dd>
            <dt>Περιοχή</dt><dd>{[s.neighborhood, s.city].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Τιμή</dt><dd>{s.price !== null ? formatMoney(s.price) : "—"}</dd>
            <dt>Εμβαδόν</dt><dd>{s.area !== null ? `${s.area} τ.μ.` : "—"}</dd>
            <dt>Υπνοδωμάτια</dt><dd>{s.bedrooms ?? "—"}</dd>
          </dl>
          <p style={{ whiteSpace: "pre-line" }}>{s.descriptionEl}</p>
          {s.rejectedReason && <div className="notice notice--warn">Λόγος απόρριψης: {s.rejectedReason}</div>}
          {s.reviewNotes && <div className="notice">Σημειώσεις: {s.reviewNotes}</div>}
        </div>

        <SubmissionActions
          submission={{ id: s.id, status: s.status, titleEl: s.titleEl, descriptionEl: s.descriptionEl, price: s.price, area: s.area, bedrooms: s.bedrooms, city: s.city, neighborhood: s.neighborhood, assignedToId: s.assignedTo?.id ?? null }}
          meId={user.id}
          convertible={convertible}
          photos={s.photos.filter((p) => p.lifecycle === "AVAILABLE" && !p.attached).map((p) => ({ id: p.id, fileName: p.fileName }))}
        />
      </div>

      <div className="panel">
        <h2>Φωτογραφίες ({s.photos.length})</h2>
        <p className="hint">Ιδιωτικές μέχρι να εγκριθούν. Οι φωτογραφίες προέρχονται από τον ιδιοκτήτη: δεν δημοσιεύονται αυτόματα και δεν θεωρούνται δικές της HOME88.</p>
        {s.photos.length === 0 ? <div className="empty">Δεν υπάρχουν φωτογραφίες.</div> : (
          <div className="mediagrid">
            {s.photos.map((p) => (
              <figure key={p.id} className="mediagrid__item">
                {thumbOf.get(p.id) ? <img src={thumbOf.get(p.id)!} alt={p.fileName ?? "Φωτογραφία ιδιοκτήτη"} loading="lazy" width={160} height={120} /> : <div className="mediagrid__none">—</div>}
                <figcaption>
                  <span className={p.lifecycle === "AVAILABLE" ? "badge badge--ok" : p.lifecycle === "QUARANTINED" ? "badge badge--warn" : "badge badge--danger"}>{MEDIA_LIFECYCLE_LABEL[p.lifecycle] ?? p.lifecycle}</span>
                  {p.attached && <span className="badge badge--info">Σε ακίνητο</span>}
                  {p.note && <span className="hint">{p.note}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Έγγραφα (ιδιωτικά)</h2>
        {s.documentsHidden ? (
          <div className="notice">Τα έγγραφα είναι διαθέσιμα στον ανατεθειμένο σύμβουλο ή σε υπεύθυνο. Αναλάβετε την υποβολή για να τα δείτε.</div>
        ) : s.documents.length === 0 ? <div className="empty">Δεν υπάρχουν έγγραφα.</div> : (
          <ul>
            {s.documents.map((d) => (
              <li key={d.id}>
                <a href={`${CRM_BASE_PATH}/submissions/${s.id}/documents/${d.id}`}>{d.title}</a> <span className="muted">({d.mimeType}, {(d.byteSize / 1024).toFixed(0)} KB)</span>
                {d.lifecycle !== "AVAILABLE" && <span className="badge badge--danger"> {MEDIA_LIFECYCLE_LABEL[d.lifecycle] ?? d.lifecycle}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Η πρόσβαση σε έγγραφο καταγράφεται και ο σύνδεσμος λήγει σε 2 λεπτά.</p>
      </div>
    </>
  );
}
