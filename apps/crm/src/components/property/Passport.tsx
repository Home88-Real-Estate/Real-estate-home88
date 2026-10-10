import Link from "next/link";
import { MANDATE_STATUS_LABELS, MANDATE_TYPES, OFFER_STATUS_LABELS } from "@home88/domain";
import { LEAD_STATUS_LABELS, label } from "@home88/types";

import { Icon, type IconName } from "@/components/Icon";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export type PassportData = {
  completeness: { percent: number; missing: string[] };
  owners: Array<{ id: string; contactId: string; reference: string; name: string; capacity: string; isPrimaryContact: boolean }>;
  leads: { count: number; latest: Array<{ id: string; reference: string; name: string; status: string; createdAt: string }> };
  viewings: { count: number; scope: "all" | "mine"; upcoming: number; latest: Array<{ id: string; clientName: string; startsAt: string; status: string }> };
  offers: { count: number; scope: "all" | "mine"; latest: Array<{ id: string; reference: string; amount: number; status: string; createdAt: string; transactionId: string | null }> };
  mandates: { scope: "all" | "mine"; signed: boolean; items: Array<{ id: string; reference: string; number: string | null; type: string; status: string; startsAt: string | null; endsAt: string | null }> };
  documents: { count: number };
  checklist: { available: true; summary: { total: number; required: number; done: number; verified: number; waiting: number; problems: number } } | { available: false; message: string };
  media: { approved: number; pending: number; rejected: number; total: number };
  intake: { sessionId: string; createdAt: string; location: { lat: number; lng: number; accuracy: number | null; source: string; visibility: "exact" | "approximate" | "private" } | null } | null;
  publication: { website: { status: string; enabled: boolean; visibility: string; lastPublishedAt: string | null } | null; onWebsite: boolean; portals: Array<{ state: string; count: number }> };
  activity: Array<{ id: string; action: string; createdAt: string; actor: string | null }>;
};

const CAPACITY: Record<string, string> = {
  OWNER: "Ιδιοκτήτης", CO_OWNER: "Συνιδιοκτήτης", USUFRUCTUARY: "Επικαρπωτής", BARE_OWNER: "Ψιλός κύριος",
  LEGAL_REPRESENTATIVE: "Νόμιμος εκπρόσωπος", ATTORNEY_IN_FACT: "Πληρεξούσιος", COMPANY_REPRESENTATIVE: "Εκπρόσωπος εταιρείας", OTHER: "Άλλο",
};
const ACTION: Record<string, string> = {
  create: "Δημιουργία", update: "Ενημέρωση", status_change: "Αλλαγή κατάστασης", document_item_add: "Προσθήκη εγγράφου στη λίστα",
  document_items_suggested: "Προσθήκη των συνήθων εγγράφων", document_item_update: "Ενημέρωση εγγράφου της λίστας", document_item_remove: "Αφαίρεση εγγράφου από τη λίστα",
  publish: "Δημοσίευση", unpublish: "Απόσυρση", trash: "Μεταφορά στα διαγραμμένα", restore: "Επαναφορά",
};
const typeLabel = (t: string) => MANDATE_TYPES.find((m) => m.value === t)?.label ?? t;

type Tone = "ok" | "warn" | "todo";
function Card({ title, icon, tone, value, href, children }: { title: string; icon: IconName; tone: Tone; value: string; href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={`pready pready--${tone}`}>
      <span className="pready__head"><Icon name={icon} size={18} /> {title}</span>
      <strong className="pready__value">{value}</strong>
      <span className="pready__body">{children}</span>
    </a>
  );
}

/**
 * Five separate readinesses, never one score: complete data is not checked documents, checked documents are
 * not a publishable advert, and none of them says the property can legally change hands.
 */
export function ReadinessBoard({ data, hasTitle, hasDescription }: { data: PassportData; hasTitle: boolean; hasDescription: boolean }) {
  const c = data.checklist;
  const docs = c.available ? c.summary : null;
  const advertReady = hasTitle && hasDescription && data.media.approved > 0;
  return (
    <section className="pboard" aria-label="Ετοιμότητα ακινήτου">
      <Card title="Πληρότητα στοιχείων" icon="table" tone={data.completeness.percent >= 100 ? "ok" : data.completeness.percent >= 60 ? "warn" : "todo"} value={`${data.completeness.percent}%`} href="#details">
        {data.completeness.missing.length ? `Λείπουν: ${data.completeness.missing.slice(0, 4).join(", ")}${data.completeness.missing.length > 4 ? "…" : ""}` : "Όλα τα βασικά στοιχεία υπάρχουν."}
      </Card>
      <Card title="Έγγραφα" icon="folder" tone={!docs ? "todo" : docs.required > 0 && docs.done === docs.required ? "ok" : docs.problems > 0 ? "warn" : "todo"} value={docs ? `${docs.done} / ${docs.required}` : "—"} href="#documents">
        {!docs ? "Η λίστα εγγράφων δεν είναι ακόμη διαθέσιμη." : docs.required === 0 ? "Δεν έχει οριστεί λίστα εγγράφων." : `${docs.waiting} εκκρεμούν${docs.problems ? ` · ${docs.problems} με πρόβλημα` : ""}`}
      </Card>
      <Card title="Νομικός / τεχνικός έλεγχος" icon="shield" tone={docs && docs.required > 0 && docs.verified === docs.required ? "ok" : "todo"} value={docs ? `${docs.verified} / ${docs.required}` : "—"} href="#documents">
        Έγγραφα που είδε υπεύθυνος του γραφείου. Ο έλεγχος από δικηγόρο και μηχανικό γίνεται χωριστά.
      </Card>
      <Card title="Ετοιμότητα αγγελίας" icon="megaphone" tone={data.publication.onWebsite ? "ok" : advertReady ? "warn" : "todo"} value={data.publication.onWebsite ? "Στον ιστότοπο" : advertReady ? "Έτοιμη" : "Όχι ακόμη"} href="#publication">
        {[hasTitle ? null : "τίτλος", hasDescription ? null : "περιγραφή", data.media.approved ? null : "εγκεκριμένη φωτογραφία"].filter(Boolean).length
          ? `Λείπει: ${[hasTitle ? null : "τίτλος", hasDescription ? null : "περιγραφή", data.media.approved ? null : "εγκεκριμένη φωτογραφία"].filter(Boolean).join(", ")}.`
          : `${data.media.approved} εγκεκριμένες φωτογραφίες${data.media.pending ? ` · ${data.media.pending} σε έλεγχο` : ""}.`}
      </Card>
      <Card title="Ετοιμότητα συναλλαγής" icon="key" tone={data.mandates.signed && data.owners.length > 0 ? "warn" : "todo"} value={data.mandates.signed ? "Εντολή σε ισχύ" : "Χωρίς εντολή"} href="#mandate">
        {data.owners.length ? `${data.owners.length} ${data.owners.length === 1 ? "ιδιοκτήτης" : "ιδιοκτήτες"}` : "Δεν έχει συνδεθεί ιδιοκτήτης"} · δεν αποτελεί βεβαίωση ότι το ακίνητο μεταβιβάζεται.
      </Card>
    </section>
  );
}

export function SectionNav() {
  const links: Array<[string, string]> = [["#details", "Στοιχεία"], ["#owners", "Ιδιοκτήτες"], ["#media", "Φωτογραφίες"], ["#documents", "Έγγραφα"], ["#mandate", "Εντολή"], ["#publication", "Δημοσίευση"], ["#interest", "Ενδιαφέρον"], ["#history", "Ιστορικό"]];
  return (
    <nav className="pnav" aria-label="Ενότητες ακινήτου">
      {links.map(([href, text]) => <a key={href} href={href}>{text}</a>)}
    </nav>
  );
}

export function OwnersPanel({ data }: { data: PassportData }) {
  return (
    <section className="panel" id="owners" aria-labelledby="owners-title">
      <div className="panel__head">
        <h2 id="owners-title">Ιδιοκτήτες</h2>
        <Link href="/contacts" className="btn btn--ghost btn--sm">Επαφές</Link>
      </div>
      {data.owners.length === 0 ? (
        <div className="empty">Δεν έχει συνδεθεί ιδιοκτήτης. Συνδέστε τον από την καρτέλα της επαφής.</div>
      ) : (
        <ul className="list">
          {data.owners.map((o) => (
            <li key={o.id}>
              <span className="list__main">
                <Link href={`/contacts/${o.contactId}`} className="list__title">{o.name}</Link>
                <span className="muted"> · {o.reference} · {CAPACITY[o.capacity] ?? o.capacity}{o.isPrimaryContact ? " · κύρια επαφή" : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LocationPanel({ data, publicPoint }: { data: PassportData; publicPoint: { lat: number; lng: number } | null }) {
  const loc = data.intake?.location ?? null;
  if (!loc && !publicPoint) return null;
  const vis = loc ? { exact: "ακριβής στον ιστότοπο", approximate: "κατά προσέγγιση (~500 μ.) στον ιστότοπο", private: "μόνο για το γραφείο" }[loc.visibility] : null;
  return (
    <section className="panel" aria-labelledby="location-title">
      <h2 id="location-title">Θέση</h2>
      <dl className="dl">
        {loc && (
          <>
            <dt>Ακριβές σημείο (γραφείο)</dt>
            <dd>
              {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)} · {loc.source === "gps" ? `GPS${loc.accuracy != null ? ` ±${loc.accuracy} μ.` : ""}` : loc.source === "map" ? "από τον χάρτη" : "πληκτρολογήθηκε"} ·{" "}
              <a href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`} target="_blank" rel="noopener noreferrer">χάρτης</a>
            </dd>
            <dt>Ορατότητα</dt>
            <dd>{vis}</dd>
          </>
        )}
        <dt>Στον ιστότοπο</dt>
        <dd>{publicPoint ? `${publicPoint.lat}, ${publicPoint.lng}` : "Χωρίς θέση στον χάρτη"}</dd>
      </dl>
      <p className="hint">Η διεύθυνση δεν δημοσιεύεται. Το ακριβές σημείο το βλέπουν ο σύμβουλος που το κατέγραψε και οι υπεύθυνοι.</p>
    </section>
  );
}

export function MandatePanel({ data, reference }: { data: PassportData; reference: string }) {
  return (
    <section className="panel" id="mandate" aria-labelledby="mandate-title">
      <div className="panel__head">
        <div>
          <h2 id="mandate-title">Εντολή ανάθεσης</h2>
          <p className="panel__sub">Από τα εγκεκριμένα κείμενα του γραφείου (Ρυθμίσεις → Ψηφιακές Εντολές). Η υπογραφή γίνεται με τη διαδικασία της εντολής.</p>
        </div>
        <Link href={`/mandates/new?property=${encodeURIComponent(reference)}`} className="btn btn--primary btn--sm">Νέα εντολή</Link>
      </div>
      {data.mandates.items.length === 0 ? (
        <div className="empty">{data.mandates.scope === "mine" ? "Δεν έχετε εντολή για αυτό το ακίνητο." : "Δεν υπάρχει εντολή για αυτό το ακίνητο."}</div>
      ) : (
        <ul className="list">
          {data.mandates.items.map((m) => (
            <li key={m.id}>
              <span className="list__main">
                <Link href={`/mandates/${m.id}`} className="list__title">{typeLabel(m.type)} <span className="mono muted">{m.number ?? m.reference}</span></Link>
                <span className="muted"> · {MANDATE_STATUS_LABELS[m.status as keyof typeof MANDATE_STATUS_LABELS] ?? m.status}{m.startsAt ? ` · από ${formatDate(m.startsAt)}` : ""}{m.endsAt ? ` έως ${formatDate(m.endsAt)}` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InterestPanel({ data, propertyId, children }: { data: PassportData; propertyId: string; children?: React.ReactNode }) {
  return (
    <section className="pinterest" id="interest" aria-label="Ενδιαφέρον">
      <div className="panel">
        <div className="panel__head">
          <h2>Leads <span className="muted">({data.leads.count})</span></h2>
          <Link href={`/leads?propertyId=${encodeURIComponent(propertyId)}`} className="btn btn--ghost btn--sm">Όλα</Link>
        </div>
        {data.leads.latest.length === 0 ? <div className="empty">Κανένα lead ακόμη.</div> : (
          <ul className="list">{data.leads.latest.map((l) => <li key={l.id}><span className="list__main"><Link href={`/leads/${l.id}`} className="list__title">{l.name}</Link><span className="muted"> · {label(LEAD_STATUS_LABELS, l.status, "el")} · {formatDate(l.createdAt)}</span></span></li>)}</ul>
        )}
      </div>
      <div className="panel">
        <div className="panel__head">
          <h2>Επισκέψεις <span className="muted">({data.viewings.count}{data.viewings.scope === "mine" ? ", δικές σας" : ""})</span></h2>
          <Link href="/calendar?new=1#new" className="btn btn--ghost btn--sm">Νέο ραντεβού</Link>
        </div>
        {data.viewings.latest.length === 0 ? <div className="empty">Καμία επίσκεψη.</div> : (
          <ul className="list">{data.viewings.latest.map((v) => <li key={v.id}><span className="list__main"><span className="list__title">{v.clientName}</span><span className="muted"> · {formatDateTime(v.startsAt)}</span></span></li>)}</ul>
        )}
      </div>
      <div className="panel">
        <h2>Προσφορές <span className="muted">({data.offers.count}{data.offers.scope === "mine" ? ", δικές σας" : ""})</span></h2>
        {data.offers.latest.length === 0 ? <div className="empty">Καμία προσφορά.</div> : (
          <ul className="list">{data.offers.latest.map((o) => <li key={o.id}><span className="list__main">{o.transactionId ? <Link href={`/transactions/${o.transactionId}`} className="list__title">{formatMoney(o.amount)}</Link> : <span className="list__title">{formatMoney(o.amount)}</span>}<span className="muted"> · {OFFER_STATUS_LABELS[o.status] ?? o.status} · {formatDate(o.createdAt)}</span></span></li>)}</ul>
        )}
      </div>
      {children}
    </section>
  );
}

export function ActivityPanel({ data }: { data: PassportData }) {
  if (data.activity.length === 0) return null;
  return (
    <div className="panel">
      <h2>Δραστηριότητα</h2>
      <ul className="list">
        {data.activity.map((a) => (
          <li key={a.id}><span className="list__main"><span className="list__title">{ACTION[a.action] ?? a.action}</span><span className="muted"> · {a.actor ?? "Σύστημα"} · {formatDateTime(a.createdAt)}</span></span></li>
        ))}
      </ul>
    </div>
  );
}
