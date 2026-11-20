"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { CRM_BASE_PATH } from "@/lib/paths";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
type TargetType = "CONTACT" | "PROPERTY";
type Transform = "TEXT" | "EMAIL" | "INTEGER" | "NUMBER_DOT" | "NUMBER_COMMA" | "BOOLEAN_MAP" | "ENUM_MAP";

export type ImportBatch = {
  id: string;
  status: string;
  sourceFileBytes: number;
  sourceFileSha256: string | null;
  requestedDelimiter: string;
  detectedDelimiter: string | null;
  parserVersion: string;
  mappingVersion: string;
  columnHeaders: string[] | null;
  sourceRowCount: number;
  stagedRowCount: number;
  invalidRowCount: number;
  duplicateRowCount: number;
  importedRowCount: number;
  createdAt: string;
  updatedAt: string;
};

type FieldOption = {
  key: string;
  label: string;
  kind: "text" | "email" | "integer" | "number" | "boolean" | "enum";
  required: boolean;
  allowedValues: string[];
};

type MappingDraft = {
  sourceHeader: string;
  targetField: string;
  transform: Transform;
  valueMapText: string;
  trueValuesText: string;
  falseValuesText: string;
};

type MappingConfig = {
  targetType: TargetType;
  fields: Array<{
    sourceHeader: string;
    targetField: string;
    transform: Transform;
    valueMap?: Record<string, string>;
    trueValues?: string[];
    falseValues?: string[];
  }>;
};

type MappingOptionsResponse = {
  headers: string[];
  targetType: TargetType;
  mappingVersion: string;
  fields: FieldOption[];
};

type PreviewRow = {
  rowNumber: number;
  status: "READY" | "DUPLICATE_REVIEW" | "SOURCE_INVALID" | "MAPPING_INVALID";
  record: Record<string, unknown>;
  issues: Array<{ code: string; field?: string; message: string }>;
  sourceIssues: unknown[];
};

type PreviewResponse = {
  summary: {
    targetType: TargetType;
    mappingVersion: string;
    totalRows: number;
    readyRows: number;
    duplicateRows: number;
    sourceInvalidRows: number;
    mappingInvalidRows: number;
  };
  data: PreviewRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
  canApprove: false;
  canImport: false;
};

type Notice = { ok: boolean; text: string };

async function apiRequest<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(CRM_BASE_PATH + "/api" + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined
      ? { accept: "application/json" }
      : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message ?? "Το αίτημα απέτυχε (" + response.status + ").");
  return data as T;
}

function transformFor(kind: FieldOption["kind"]): Transform {
  switch (kind) {
    case "email": return "EMAIL";
    case "integer": return "INTEGER";
    case "number": return "NUMBER_COMMA";
    case "boolean": return "BOOLEAN_MAP";
    case "enum": return "ENUM_MAP";
    default: return "TEXT";
  }
}

function transformChoices(kind: FieldOption["kind"]): Transform[] {
  switch (kind) {
    case "email": return ["EMAIL"];
    case "integer": return ["INTEGER"];
    case "number": return ["NUMBER_DOT", "NUMBER_COMMA"];
    case "boolean": return ["BOOLEAN_MAP"];
    case "enum": return ["ENUM_MAP"];
    default: return ["TEXT"];
  }
}

function parsePairs(input: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new Error("Γράψτε κάθε αντιστοίχιση στη μορφή αρχική τιμή = τιμή HOME88.");
    }
    const source = trimmed.slice(0, separator).trim();
    const target = trimmed.slice(separator + 1).trim();
    if (!source || !target || Object.prototype.hasOwnProperty.call(output, source)) {
      throw new Error("Υπάρχει κενή ή διπλή αρχική τιμή στην αντιστοίχιση.");
    }
    output[source] = target;
  }
  return output;
}

function splitValues(value: string): string[] {
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
}

function asMappingDraft(mapping: unknown): { targetType: TargetType; fields: MappingDraft[] } | null {
  if (!mapping || typeof mapping !== "object") return null;
  const value = mapping as { targetType?: unknown; fields?: unknown };
  if ((value.targetType !== "CONTACT" && value.targetType !== "PROPERTY") || !Array.isArray(value.fields)) return null;
  return {
    targetType: value.targetType,
    fields: value.fields.flatMap((entry): MappingDraft[] => {
      if (!entry || typeof entry !== "object") return [];
      const field = entry as Record<string, unknown>;
      if (typeof field.sourceHeader !== "string" || typeof field.targetField !== "string" || typeof field.transform !== "string") return [];
      return [{
        sourceHeader: field.sourceHeader,
        targetField: field.targetField,
        transform: field.transform as Transform,
        valueMapText: field.valueMap && typeof field.valueMap === "object"
          ? Object.entries(field.valueMap as Record<string, string>).map(([key, target]) => key + " = " + target).join("\n")
          : "",
        trueValuesText: Array.isArray(field.trueValues) ? field.trueValues.join(", ") : "",
        falseValuesText: Array.isArray(field.falseValues) ? field.falseValues.join(", ") : "",
      }];
    }),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const STATUS_LABEL: Record<string, string> = {
  CREATED: "Νέο αρχείο",
  PARSING: "Ανάλυση",
  STAGED: "Έτοιμο για αντιστοίχιση",
  NEEDS_REVIEW: "Χρειάζεται έλεγχο",
  FAILED: "Αποτυχία",
  IMPORTING: "Σε εισαγωγή",
  COMPLETED: "Ολοκληρώθηκε",
  CANCELLED: "Ακυρώθηκε",
};

function statusClass(status: string): string {
  if (status === "STAGED" || status === "COMPLETED") return "badge badge--ok";
  if (status === "NEEDS_REVIEW" || status === "PARSING") return "badge badge--warn";
  if (status === "FAILED") return "badge badge--danger";
  return "badge badge--muted";
}

function previewStatusLabel(status: PreviewRow["status"]): string {
  return ({
    READY: "Έτοιμη",
    DUPLICATE_REVIEW: "Πιθανό διπλότυπο",
    SOURCE_INVALID: "Μη έγκυρη γραμμή",
    MAPPING_INVALID: "Έλεγχος αντιστοίχισης",
  })[status];
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Ναι" : "Όχι";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.length > 180 ? text.slice(0, 177) + "…" : text;
}

export function ImportWorkspace({ initialBatches }: { initialBatches: ImportBatch[] }) {
  const router = useRouter();
  const [batches, setBatches] = useState(initialBatches);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [testFileConfirmed, setTestFileConfirmed] = useState(false);

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<TargetType>("CONTACT");
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldOptions, setFieldOptions] = useState<FieldOption[]>([]);
  const [mappingRows, setMappingRows] = useState<MappingDraft[]>([]);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingNotice, setMappingNotice] = useState<Notice | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewPage, setPreviewPage] = useState(1);

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  async function uploadAndStage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setNotice({ ok: false, text: "Επιλέξτε ένα αρχείο CSV." });
      return;
    }
    if (!/\.csv$/i.test(file.name) || file.size > MAX_FILE_BYTES) {
      setNotice({ ok: false, text: "Επιτρέπονται αρχεία CSV έως 20 MB." });
      return;
    }
    if (!testFileConfirmed) {
      setNotice({ ok: false, text: "Η επιβεβαίωση δοκιμαστικού ή πλήρως ανωνυμοποιημένου αρχείου είναι υποχρεωτική." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const ticket = await apiRequest<{
        batch: { id: string };
        upload: { url: string; headers: Record<string, string> };
      }>("/legacy-imports", "POST", {
        fileName: file.name,
        byteSize: file.size,
        delimiter: "AUTO",
      });

      const upload = await fetch(ticket.upload.url, {
        method: "PUT",
        headers: ticket.upload.headers,
        body: file,
      });
      if (!upload.ok) throw new Error("Η αποθήκευση του αρχείου απέτυχε (" + upload.status + ").");

      await apiRequest<{
        batch: { id: string; status: string };
        nextStep: string;
      }>("/legacy-imports/" + encodeURIComponent(ticket.batch.id) + "/parse", "POST", {});

      const detail = await apiRequest<{ batch: ImportBatch }>(
        "/legacy-imports/" + encodeURIComponent(ticket.batch.id),
      );
      setBatches((current) => [detail.batch, ...current.filter((batch) => batch.id !== detail.batch.id)]);
      form.reset();
      setTestFileConfirmed(false);
      setNotice({
        ok: true,
        text: "Το CSV αναλύθηκε και αποθηκεύτηκε σε ασφαλή χώρο ελέγχου. Ελέγξτε τις γραμμές πριν ορίσετε την αντιστοίχιση.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : "Η μεταφόρτωση ή ανάλυση απέτυχε.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function openMapping(batch: ImportBatch) {
    setSelectedBatchId(batch.id);
    setFieldOptions([]);
    setHeaders([]);
    setMappingBusy(true);
    setMappingNotice(null);
    setPreview(null);
    setPreviewPage(1);
    try {
      const detail = await apiRequest<{ batch: { fieldMapping?: unknown } }>(
        "/legacy-imports/" + encodeURIComponent(batch.id),
      );
      const saved = asMappingDraft(detail.batch.fieldMapping);
      const nextTarget = saved?.targetType ?? "CONTACT";
      const options = await apiRequest<MappingOptionsResponse>(
        "/legacy-imports/" + encodeURIComponent(batch.id) + "/mapping-options?targetType=" + nextTarget,
      );
      setTargetType(nextTarget);
      setHeaders(options.headers);
      setFieldOptions(options.fields);
      setMappingRows(saved?.fields ?? []);
      setMappingNotice(null);
    } catch (error) {
      setMappingNotice({ ok: false, text: error instanceof Error ? error.message : "Δεν ήταν δυνατή η φόρτωση των πεδίων." });
    } finally {
      setMappingBusy(false);
    }
  }

  async function changeTarget(nextTarget: TargetType) {
    if (!selectedBatchId) return;
    setTargetType(nextTarget);
    setMappingRows([]);
    setPreview(null);
    setMappingNotice(null);
    setMappingBusy(true);
    try {
      const options = await apiRequest<MappingOptionsResponse>(
        "/legacy-imports/" + encodeURIComponent(selectedBatchId) + "/mapping-options?targetType=" + nextTarget,
      );
      setHeaders(options.headers);
      setFieldOptions(options.fields);
    } catch (error) {
      setMappingNotice({ ok: false, text: error instanceof Error ? error.message : "Δεν φορτώθηκαν τα διαθέσιμα πεδία." });
    } finally {
      setMappingBusy(false);
    }
  }

  function addMappingRow() {
    const unused = fieldOptions.find((field) => !mappingRows.some((row) => row.targetField === field.key));
    if (!unused) {
      setMappingNotice({ ok: false, text: "Έχουν προστεθεί όλα τα διαθέσιμα πεδία." });
      return;
    }
    setMappingRows((current) => [
      ...current,
      {
        sourceHeader: "",
        targetField: unused.key,
        transform: transformFor(unused.kind),
        valueMapText: "",
        trueValuesText: "",
        falseValuesText: "",
      },
    ]);
    setPreview(null);
  }

  function updateMappingRow(index: number, patch: Partial<MappingDraft>) {
    setMappingRows((current) => current.map((row, position) => {
      if (position !== index) return row;
      if (patch.targetField) {
        const option = fieldOptions.find((field) => field.key === patch.targetField);
        return {
          ...row,
          ...patch,
          transform: option ? transformFor(option.kind) : row.transform,
          valueMapText: "",
          trueValuesText: "",
          falseValuesText: "",
        };
      }
      return { ...row, ...patch };
    }));
    setPreview(null);
  }

  function removeMappingRow(index: number) {
    setMappingRows((current) => current.filter((_, position) => position !== index));
    setPreview(null);
  }

  function makeMapping(): MappingConfig {
    if (mappingRows.length === 0) throw new Error("Προσθέστε τουλάχιστον μία αντιστοίχιση.");
    const fields = mappingRows.map((row) => {
      if (!row.sourceHeader || !row.targetField) throw new Error("Επιλέξτε αρχική στήλη και πεδίο HOME88 σε κάθε γραμμή.");
      const option = fieldOptions.find((field) => field.key === row.targetField);
      if (!option) throw new Error("Ένα από τα πεδία HOME88 δεν είναι πλέον διαθέσιμο.");
      const field: MappingConfig["fields"][number] = {
        sourceHeader: row.sourceHeader,
        targetField: row.targetField,
        transform: row.transform,
      };
      if (row.transform === "ENUM_MAP") {
        const valueMap = parsePairs(row.valueMapText);
        if (Object.keys(valueMap).length === 0) throw new Error("Συμπληρώστε τις επιτρεπόμενες τιμές για το πεδίο " + option.label + ".");
        field.valueMap = valueMap;
      }
      if (row.transform === "BOOLEAN_MAP") {
        field.trueValues = splitValues(row.trueValuesText);
        field.falseValues = splitValues(row.falseValuesText);
        if (!field.trueValues.length || !field.falseValues.length) {
          throw new Error("Ορίστε τις τιμές ΝΑΙ και ΟΧΙ για το πεδίο " + option.label + ".");
        }
      }
      return field;
    });
    return { targetType, fields };
  }

  async function saveAndPreview() {
    if (!selectedBatchId) return;
    setMappingBusy(true);
    setMappingNotice(null);
    setPreview(null);
    try {
      const mapping = makeMapping();
      await apiRequest(
        "/legacy-imports/" + encodeURIComponent(selectedBatchId) + "/mapping",
        "PUT",
        mapping,
      );
      const result = await apiRequest<PreviewResponse>(
        "/legacy-imports/" + encodeURIComponent(selectedBatchId) + "/mapping/preview?page=1&limit=10",
        "POST",
        {},
      );
      setPreview(result);
      setPreviewPage(1);
      setMappingNotice({
        ok: true,
        text: "Η αντιστοίχιση αποθηκεύτηκε. Η προεπισκόπηση δεν δημιουργεί επαφές ή ακίνητα.",
      });
      router.refresh();
    } catch (error) {
      setMappingNotice({
        ok: false,
        text: error instanceof Error ? error.message : "Δεν ολοκληρώθηκε ο έλεγχος της αντιστοίχισης.",
      });
    } finally {
      setMappingBusy(false);
    }
  }

  async function changePreviewPage(page: number) {
    if (!selectedBatchId || !preview) return;
    setMappingBusy(true);
    setMappingNotice(null);
    try {
      const result = await apiRequest<PreviewResponse>(
        "/legacy-imports/" + encodeURIComponent(selectedBatchId) + "/mapping/preview?page=" + page + "&limit=10",
        "POST",
        {},
      );
      setPreview(result);
      setPreviewPage(page);
    } catch (error) {
      setMappingNotice({ ok: false, text: error instanceof Error ? error.message : "Δεν φορτώθηκε η επόμενη σελίδα." });
    } finally {
      setMappingBusy(false);
    }
  }

  return (
    <div className="import-workspace">
      <section className="notice notice--warn import-safety" aria-label="Προειδοποίηση ασφαλείας">
        <strong>Περιβάλλον ελέγχου — όχι ακόμη πραγματική μεταφορά πελατών.</strong>
        <p>Μέχρι να οριστεί πολιτική διατήρησης δεδομένων και να ελεγχθεί πραγματικό δείγμα Estate+, χρησιμοποιήστε μόνο συνθετικά ή πλήρως ανωνυμοποιημένα CSV. Η προεπισκόπηση δεν καταχωρίζει δεδομένα στο CRM.</p>
      </section>

      <div className="import-layout">
        <section className="panel import-panel">
          <div className="import-section-heading">
            <div>
              <span className="eyebrow">PHASE D · STAGING</span>
              <h2>Νέο αρχείο CSV</h2>
              <p className="muted">Ανεβάστε ένα δοκιμαστικό export για έλεγχο στηλών και γραμμών.</p>
            </div>
            <span className="import-icon" aria-hidden="true">↑</span>
          </div>
          <form onSubmit={uploadAndStage} className="import-upload-form">
            <label className="import-file-label" htmlFor="estate-plus-file">
              <span className="import-file-symbol" aria-hidden="true">CSV</span>
              <span>
                <strong>Επιλογή αρχείου</strong>
                <small>UTF-8 · έως 20 MB · .csv</small>
              </span>
              <input id="estate-plus-file" name="file" type="file" accept=".csv,text/csv" disabled={busy} required />
            </label>
            <label className="import-confirm">
              <input
                type="checkbox"
                checked={testFileConfirmed}
                onChange={(event) => setTestFileConfirmed(event.target.checked)}
                disabled={busy}
              />
              <span>Επιβεβαιώνω ότι το αρχείο περιέχει μόνο συνθετικά ή πλήρως ανωνυμοποιημένα δεδομένα.</span>
            </label>
            <button type="submit" className="btn btn--primary" disabled={busy || !testFileConfirmed}>
              {busy ? "Μεταφόρτωση και έλεγχος…" : "Μεταφόρτωση & ανάλυση"}
            </button>
          </form>
          {notice && <p className={notice.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{notice.text}</p>}
          <div className="import-footnote">
            <span aria-hidden="true">i</span>
            Το αρχικό CSV διαγράφεται μετά την ασφαλή αποθήκευση των κρυπτογραφημένων γραμμών. Η πολιτική διατήρησης των staged εγγραφών εκκρεμεί.
          </div>
        </section>

        <section className="panel import-batches">
          <div className="import-section-heading">
            <div>
              <span className="eyebrow">ΙΣΤΟΡΙΚΟ</span>
              <h2>Παρτίδες εισαγωγής</h2>
              <p className="muted">Κάθε αρχείο παραμένει ξεχωριστό και ελέγξιμο.</p>
            </div>
            <span className="import-count">{batches.length}</span>
          </div>
          {batches.length === 0 ? (
            <div className="import-empty">
              <span aria-hidden="true">▤</span>
              <strong>Δεν υπάρχουν αρχεία ακόμη</strong>
              <p>Οι παρτίδες που θα αναλυθούν εμφανίζονται εδώ.</p>
            </div>
          ) : (
            <div className="import-batch-list">
              {batches.map((batch) => (
                <article className="import-batch" key={batch.id}>
                  <div className="import-batch-main">
                    <strong className="mono">{batch.id.slice(0, 8).toUpperCase()}</strong>
                    <span className={statusClass(batch.status)}>{STATUS_LABEL[batch.status] ?? batch.status}</span>
                    <small>{formatDate(batch.createdAt)} · {formatBytes(batch.sourceFileBytes)}</small>
                  </div>
                  <div className="import-batch-stats">
                    <span><strong>{batch.sourceRowCount}</strong> γραμμές</span>
                    <span><strong>{batch.stagedRowCount}</strong> έτοιμες</span>
                    <span><strong>{batch.duplicateRowCount}</strong> διπλότυπα</span>
                  </div>
                  {batch.columnHeaders && (
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => void openMapping(batch)} disabled={mappingBusy}>
                      Αντιστοίχιση & έλεγχος
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedBatchId && (
        <section className="panel import-mapping-panel" aria-labelledby="import-mapping-title">
          <div className="import-section-heading">
            <div>
              <span className="eyebrow">MAPPING WORKSPACE</span>
              <h2 id="import-mapping-title">Αντιστοίχιση στηλών HOME88</h2>
              <p className="muted">Επιλέξτε χειροκίνητα την πηγή, το πεδίο προορισμού και τη μορφή μετατροπής.</p>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setSelectedBatchId(null); setPreview(null); }}>
              Κλείσιμο
            </button>
          </div>

          {mappingBusy && !fieldOptions.length ? (
            <p className="muted">Φόρτωση πεδίων…</p>
          ) : (
            <>
              <div className="import-mapping-toolbar">
                <div className="field">
                  <label htmlFor="import-target-type">Τύπος εγγραφής HOME88</label>
                  <select id="import-target-type" className="select" value={targetType} onChange={(event) => void changeTarget(event.target.value as TargetType)} disabled={mappingBusy}>
                    <option value="CONTACT">Επαφή</option>
                    <option value="PROPERTY">Ακίνητο (πρόχειρο)</option>
                  </select>
                </div>
                <div className="import-source-headers">
                  <span>Στήλες αρχείου</span>
                  <div>{headers.map((header) => <span className="import-header-chip" key={header}>{header}</span>)}</div>
                </div>
              </div>

              <div className="import-mapping-rows">
                {mappingRows.map((row, index) => {
                  const option = fieldOptions.find((field) => field.key === row.targetField);
                  const compatible = option ? transformChoices(option.kind) : [];
                  return (
                    <div className="import-mapping-row" key={index}>
                      <div className="field">
                        <label htmlFor={"import-source-" + index}>Αρχική στήλη</label>
                        <select id={"import-source-" + index} className="select" value={row.sourceHeader} onChange={(event) => updateMappingRow(index, { sourceHeader: event.target.value })}>
                          <option value="">Επιλέξτε στήλη CSV</option>
                          {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={"import-target-" + index}>Πεδίο HOME88</label>
                        <select id={"import-target-" + index} className="select" value={row.targetField} onChange={(event) => updateMappingRow(index, { targetField: event.target.value })}>
                          {fieldOptions.map((field) => (
                            <option key={field.key} value={field.key} disabled={mappingRows.some((other, otherIndex) => otherIndex !== index && other.targetField === field.key)}>
                              {field.label}{field.required ? " · απαιτείται" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={"import-transform-" + index}>Μορφή τιμής</label>
                        <select id={"import-transform-" + index} className="select" value={row.transform} onChange={(event) => updateMappingRow(index, { transform: event.target.value as Transform })}>
                          {compatible.map((transform) => <option key={transform} value={transform}>{transform}</option>)}
                        </select>
                      </div>
                      <button type="button" className="btn btn--ghost btn--sm import-remove-row" onClick={() => removeMappingRow(index)} aria-label="Αφαίρεση αντιστοίχισης">Αφαίρεση</button>

                      {row.transform === "ENUM_MAP" && (
                        <div className="field import-transform-detail">
                          <label htmlFor={"import-values-" + index}>Αντιστοίχιση τιμών (μία ανά γραμμή: αρχική = HOME88)</label>
                          <textarea id={"import-values-" + index} className="input" rows={3} value={row.valueMapText} onChange={(event) => updateMappingRow(index, { valueMapText: event.target.value })} placeholder={"Πώληση = SALE\nΕνοικίαση = RENT"} />
                          {option?.allowedValues.length ? <small className="hint">Επιτρεπόμενες τιμές HOME88: {option.allowedValues.join(", ")}</small> : null}
                        </div>
                      )}
                      {row.transform === "BOOLEAN_MAP" && (
                        <div className="import-transform-detail import-boolean-grid">
                          <div className="field">
                            <label htmlFor={"import-true-" + index}>Τιμές ΝΑΙ (χωρισμένες με κόμμα)</label>
                            <input id={"import-true-" + index} className="input" value={row.trueValuesText} onChange={(event) => updateMappingRow(index, { trueValuesText: event.target.value })} placeholder="ΝΑΙ, Ναι, Yes, 1" />
                          </div>
                          <div className="field">
                            <label htmlFor={"import-false-" + index}>Τιμές ΟΧΙ (χωρισμένες με κόμμα)</label>
                            <input id={"import-false-" + index} className="input" value={row.falseValuesText} onChange={(event) => updateMappingRow(index, { falseValuesText: event.target.value })} placeholder="ΟΧΙ, Όχι, No, 0" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="row import-mapping-actions">
                <button type="button" className="btn btn--outline" onClick={addMappingRow} disabled={mappingBusy || mappingRows.length >= Math.min(80, fieldOptions.length)}>
                  + Προσθήκη πεδίου
                </button>
                <button type="button" className="btn btn--primary" onClick={() => void saveAndPreview()} disabled={mappingBusy || mappingRows.length === 0}>
                  {mappingBusy ? "Έλεγχος…" : "Αποθήκευση & προεπισκόπηση"}
                </button>
              </div>
            </>
          )}

          {mappingNotice && <p className={mappingNotice.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{mappingNotice.text}</p>}

          {preview && (
            <div className="import-preview">
              <div className="import-preview-head">
                <div>
                  <span className="eyebrow">DRY RUN · ΧΩΡΙΣ ΕΓΓΡΑΦΕΣ ΣΤΟ CRM</span>
                  <h3>Αποτελέσματα ελέγχου</h3>
                </div>
                <span className="badge badge--muted">Σελίδα {previewPage} / {preview.pagination.pages}</span>
              </div>
              <div className="import-preview-stats">
                <div><strong>{preview.summary.totalRows}</strong><span>Σύνολο</span></div>
                <div><strong>{preview.summary.readyRows}</strong><span>Έτοιμες</span></div>
                <div><strong>{preview.summary.duplicateRows}</strong><span>Διπλότυπα</span></div>
                <div><strong>{preview.summary.sourceInvalidRows + preview.summary.mappingInvalidRows}</strong><span>Με σφάλματα</span></div>
              </div>
              {preview.data.length === 0 ? (
                <p className="muted">Δεν υπάρχουν γραμμές σε αυτή τη σελίδα.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data import-preview-table">
                    <thead>
                      <tr><th>Γραμμή</th><th>Κατάσταση</th><th>Μετασχηματισμένα δεδομένα</th><th>Έλεγχοι</th></tr>
                    </thead>
                    <tbody>
                      {preview.data.map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="mono">{row.rowNumber}</td>
                          <td>
                            <span className={row.status === "READY" ? "badge badge--ok" : row.status === "DUPLICATE_REVIEW" ? "badge badge--warn" : "badge badge--danger"}>
                              {previewStatusLabel(row.status)}
                            </span>
                          </td>
                          <td>
                            <div className="import-preview-fields">
                              {Object.entries(row.record).map(([key, value]) => (
                                <span key={key}><small>{fieldOptions.find((field) => field.key === key)?.label ?? key}</small><strong>{previewValue(value)}</strong></span>
                              ))}
                            </div>
                          </td>
                          <td>
                            {row.issues.length === 0 && row.sourceIssues.length === 0
                              ? <span className="muted">—</span>
                              : <ul className="import-issue-list">{row.issues.map((issue, index) => <li key={issue.code + index}>{issue.message}</li>)}{row.sourceIssues.map((issue, index) => <li key={"source-" + index}>{typeof issue === "object" && issue && "code" in issue ? String((issue as { code: unknown }).code) : "Αρχικό σφάλμα"}</li>)}</ul>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row import-preview-pagination">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void changePreviewPage(previewPage - 1)} disabled={mappingBusy || previewPage <= 1}>Προηγούμενη</button>
                <span className="muted">Εμφάνιση {preview.data.length} από {preview.pagination.total} γραμμές</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void changePreviewPage(previewPage + 1)} disabled={mappingBusy || previewPage >= preview.pagination.pages}>Επόμενη</button>
              </div>
              <div className="notice import-no-write">
                Η προεπισκόπηση δεν είναι έγκριση. Δεν δημιουργήθηκε επαφή ή ακίνητο και δεν υπάρχει ακόμη δυνατότητα εκτέλεσης εισαγωγής.
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
