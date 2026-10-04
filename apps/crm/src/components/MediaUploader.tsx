"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { browserIO } from "@/lib/browser-upload";
import { fileFingerprint, uploadAll, type UploadUpdate } from "@/lib/upload-queue";

const UPLOAD_KINDS = ["PHOTO", "FLOOR_PLAN", "DOCUMENT", "VIDEO", "VIRTUAL_TOUR"];

const STATE_LABEL: Record<UploadUpdate["state"], string> = {
  queued: "Σε αναμονή",
  preparing: "Προετοιμασία",
  uploading: "Μεταφόρτωση",
  confirming: "Καταχώριση",
  done: "Ολοκληρώθηκε",
  failed: "Απέτυχε",
};

type Row = { name: string; update: UploadUpdate };

export function MediaUploader({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const seen = useRef(new Set<string>());
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  // Leaving the page would abandon files still in memory: ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  async function start(fileList: FileList | null) {
    const picked = Array.from(fileList ?? []).filter((file) => file.size > 0);
    const files = picked.filter((file) => {
      const fingerprint = fileFingerprint(file);
      if (seen.current.has(fingerprint)) return false;
      seen.current.add(fingerprint);
      return true;
    });
    if (inputRef.current) inputRef.current.value = "";
    const skipped = picked.length - files.length;
    if (files.length === 0) {
      setSummary(skipped > 0 ? "Τα αρχεία αυτά έχουν ήδη μεταφορτωθεί." : null);
      return;
    }

    setBusy(true);
    setSummary(null);
    setRows(files.map((file) => ({ name: file.name, update: { state: "queued", progress: 0 } })));

    const result = await uploadAll(browserIO(propertyId), files, kind || undefined, (index, update) =>
      setRows((current) => current.map((row, i) => (i === index ? { ...row, update } : row))),
    );

    setBusy(false);
    setSummary(
      `${result.done} ολοκληρώθηκαν` +
        (result.failed ? `, ${result.failed} απέτυχαν` : "") +
        (skipped ? `, ${skipped} διπλότυπα παραλείφθηκαν` : "") +
        ". Τα νέα αρχεία περιμένουν έγκριση.",
    );
    if (result.done > 0) router.refresh();
  }

  return (
    <div className="stack">
      <div className="media-upload">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml,application/pdf"
          disabled={busy}
          onChange={(event) => void start(event.target.files)}
          aria-label="Επιλογή αρχείων"
        />
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Τύπος" disabled={busy}>
          <option value="">Αυτόματα</option>
          {UPLOAD_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {offline && busy && (
        <div className="notice" role="status">
          Χωρίς σύνδεση — οι μεταφορτώσεις συνεχίζονται αυτόματα μόλις επανέλθει το δίκτυο.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="upload-list">
          {rows.map((row, index) => (
            <li key={`${row.name}-${index}`} data-state={row.update.state}>
              <span className="upload-list__name">{row.name}</span>
              <progress max={1} value={row.update.state === "done" ? 1 : row.update.progress} />
              <span className="muted">
                {STATE_LABEL[row.update.state]}
                {row.update.message ? ` — ${row.update.message}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {summary && <p className="muted" role="status">{summary}</p>}
    </div>
  );
}
