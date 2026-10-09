"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fileFingerprint, type UploadUpdate } from "@/lib/upload-queue";

export type PendingFile = { id: string; file: File };

/** Photo types the gallery takes; the API enforces the same list for kind PHOTO. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const ACCEPT = [...PHOTO_TYPES, ".jpg", ".jpeg", ".png", ".webp", ".avif"].join(",");
/** Photos per save; more can be added on the property page afterwards. */
export const MAX_PENDING_PHOTOS = 40;
const MB = 1024 * 1024;

const STATE_LABEL: Record<UploadUpdate["state"], string> = {
  queued: "Επιλεγμένο",
  preparing: "Μεταφόρτωση…",
  uploading: "Μεταφόρτωση…",
  confirming: "Μεταφόρτωση…",
  done: "Ολοκληρώθηκε",
  failed: "Αποτυχία",
};

/** Some systems leave `type` empty for AVIF/WEBP; fall back to the extension. */
function photoType(file: File): string | null {
  if (PHOTO_TYPES.includes(file.type)) return file.type;
  if (file.type) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext && PHOTO_TYPES.includes(`image/${ext}`) ? `image/${ext}` : null;
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" width={72} height={72} className="pending-media__thumb" />;
}

/**
 * Photos picked on the "new property" form. Nothing is uploaded yet: the files
 * wait here (with thumbnails, reorder and remove) until the property exists,
 * because uploads belong to a property. The first photo becomes the cover.
 * On a phone the picker offers the camera and the gallery.
 */
export function PendingMedia({
  files,
  onChange,
  progress,
  disabled,
  maxBytes,
  camera,
}: {
  files: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  /** The server's per-file limit. */
  maxBytes: number;
  /** Per-file upload state once saving has started. */
  progress?: Record<string, UploadUpdate>;
  disabled?: boolean;
  /** Adds a "take photo" button that opens the phone camera directly (the gallery stays one tap away). */
  camera?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  /** File picker and drop zone both land here: one validation, one queue. */
  function add(list: FileList | File[]) {
    const known = new Set(files.map((f) => fileFingerprint(f.file)));
    const fresh: PendingFile[] = [];
    const rejected: string[] = [];
    let duplicates = 0;
    for (const original of Array.from(list)) {
      const type = photoType(original);
      if (!type) {
        rejected.push(`${original.name}: δεν είναι φωτογραφία JPG, PNG, WEBP ή AVIF.`);
        continue;
      }
      if (original.size === 0) {
        rejected.push(`${original.name}: το αρχείο είναι κενό.`);
        continue;
      }
      if (original.size > maxBytes) {
        rejected.push(`${original.name}: ξεπερνά τα ${Math.floor(maxBytes / MB)} MB.`);
        continue;
      }
      if (files.length + fresh.length >= MAX_PENDING_PHOTOS) {
        rejected.push(`${original.name}: έως ${MAX_PENDING_PHOTOS} φωτογραφίες ανά αποθήκευση.`);
        continue;
      }
      const fp = fileFingerprint(original);
      if (known.has(fp)) {
        duplicates += 1;
        continue;
      }
      known.add(fp);
      // A typeless file gets its real type so the upload is signed for it.
      const file = original.type ? original : new File([original], original.name, { type, lastModified: original.lastModified });
      fresh.push({ id: `${fp}-${Math.random().toString(36).slice(2)}`, file });
    }
    setNotes([...rejected, ...(duplicates > 0 ? [`${duplicates} διπλότυπα αρχεία παραλείφθηκαν.`] : [])]);
    if (input.current) input.current.value = "";
    if (fresh.length > 0) onChange([...files, ...fresh]);
  }

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= files.length) return;
    const next = [...files];
    [next[index], next[to]] = [next[to]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="pending-media">
      <div
        className={over ? "pending-media__drop is-over" : "pending-media__drop"}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) add(e.dataTransfer.files);
        }}
      >
        <p>Σύρετε φωτογραφίες εδώ ή</p>
        {camera && (
          <>
            <button type="button" className="btn btn--primary btn--sm" disabled={disabled} onClick={() => cameraInput.current?.click()}>
              Λήψη φωτογραφίας
            </button>
            {/* `capture` opens the rear camera on phones; desktop browsers fall back to the file picker. */}
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden disabled={disabled} onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} aria-label="Λήψη φωτογραφίας" />
          </>
        )}
        <button type="button" className="btn btn--outline btn--sm" disabled={disabled} onClick={() => input.current?.click()}>
          {camera ? "Επιλογή από τη συλλογή" : "Επιλογή αρχείων"}
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden disabled={disabled} onChange={(e) => e.target.files && add(e.target.files)} aria-label="Επιλογή φωτογραφιών" />
        <p className="hint">
          JPG, PNG, WEBP ή AVIF, έως {Math.floor(maxBytes / MB)} MB η καθεμία και έως {MAX_PENDING_PHOTOS} φωτογραφίες. Η πρώτη φωτογραφία
          γίνεται εξώφυλλο. Αποθηκεύονται μαζί με το ακίνητο και περιμένουν έγκριση πριν δημοσιευτούν.
        </p>
      </div>

      {notes.length > 0 && (
        <ul className="pending-media__notes error" role="alert">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <p className="hint" role="status" aria-live="polite">
          {progress
            ? `${files.filter((f) => progress[f.id]?.state === "done").length} / ${files.length} φωτογραφίες ολοκληρώθηκαν` +
              (files.some((f) => progress[f.id]?.state === "failed") ? ` · ${files.filter((f) => progress[f.id]?.state === "failed").length} απέτυχαν` : "")
            : `${files.length} ${files.length === 1 ? "φωτογραφία επιλεγμένη" : "φωτογραφίες επιλεγμένες"}`}
        </p>
      )}

      {files.length > 0 && (
        <ul className="pending-media__list" aria-label="Αρχεία προς μεταφόρτωση">
          {files.map((item, index) => {
            const update = progress?.[item.id];
            return (
              <li key={item.id} className="pending-media__item">
                <Thumb file={item.file} />
                <div className="pending-media__meta">
                  <span className="pending-media__name">
                    {item.file.name}
                    {index === 0 && <span className="badge badge--info"> Εξώφυλλο</span>}
                  </span>
                  <span className="hint">{item.file.size >= MB ? `${(item.file.size / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(item.file.size / 1024))} KB`}</span>
                  {(update || !progress) && (
                    <span className={update?.state === "failed" ? "error" : update?.state === "done" ? "pending-media__ok" : "hint"}>
                      {STATE_LABEL[update?.state ?? "queued"]}
                      {update?.state === "uploading" && update.progress > 0 && ` ${Math.round(update.progress * 100)}%`}
                      {update?.state === "failed" && update.message ? `: ${update.message}` : ""}
                    </span>
                  )}
                </div>
                {!progress && (
                  <div className="pending-media__actions">
                    <button type="button" className="btn btn--outline btn--sm" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label="Μετακίνηση πάνω">↑</button>
                    <button type="button" className="btn btn--outline btn--sm" disabled={disabled || index === files.length - 1} onClick={() => move(index, 1)} aria-label="Μετακίνηση κάτω">↓</button>
                    <button type="button" className="btn btn--outline btn--sm" disabled={disabled} onClick={() => onChange(files.filter((f) => f.id !== item.id))} aria-label={`Αφαίρεση ${item.file.name}`}>✕</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
