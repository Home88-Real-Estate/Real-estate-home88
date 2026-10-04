"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fileFingerprint, type UploadUpdate } from "@/lib/upload-queue";

export type PendingFile = { id: string; file: File };

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf";
const MB = 1024 * 1024;

const STATE_LABEL: Record<UploadUpdate["state"], string> = {
  queued: "Σε αναμονή",
  preparing: "Προετοιμασία",
  uploading: "Μεταφόρτωση",
  confirming: "Καταχώριση",
  done: "Ολοκληρώθηκε",
  failed: "Απέτυχε",
};

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url ? <img src={url} alt="" width={72} height={72} className="pending-media__thumb" /> : <span className="pending-media__thumb pending-media__thumb--doc">PDF</span>;
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
}: {
  files: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  /** Per-file upload state once saving has started. */
  progress?: Record<string, UploadUpdate>;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function add(list: FileList | File[]) {
    const known = new Set(files.map((f) => fileFingerprint(f.file)));
    const fresh: PendingFile[] = [];
    let duplicates = 0;
    for (const file of Array.from(list)) {
      if (file.size === 0) continue;
      const fp = fileFingerprint(file);
      if (known.has(fp)) {
        duplicates += 1;
        continue;
      }
      known.add(fp);
      fresh.push({ id: `${fp}-${Math.random().toString(36).slice(2)}`, file });
    }
    setNote(duplicates > 0 ? `${duplicates} διπλότυπα αρχεία παραλείφθηκαν.` : null);
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
        <button type="button" className="btn btn--outline btn--sm" disabled={disabled} onClick={() => input.current?.click()}>
          Επιλογή αρχείων
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden disabled={disabled} onChange={(e) => e.target.files && add(e.target.files)} aria-label="Επιλογή φωτογραφιών" />
        <p className="hint">JPG, PNG, WEBP, AVIF ή PDF. Η πρώτη φωτογραφία γίνεται εξώφυλλο. Αποθηκεύονται μαζί με το ακίνητο και περιμένουν έγκριση πριν δημοσιευτούν.</p>
      </div>

      {note && <p className="hint" role="status">{note}</p>}

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
                    {index === 0 && !item.file.type.includes("pdf") && <span className="badge badge--info"> Εξώφυλλο</span>}
                  </span>
                  <span className="hint">{(item.file.size / MB).toFixed(1)} MB</span>
                  {update && (
                    <span className={update.state === "failed" ? "error" : "hint"}>
                      {STATE_LABEL[update.state]}
                      {update.state === "uploading" && ` ${Math.round(update.progress * 100)}%`}
                      {update.state === "failed" && update.message ? `: ${update.message}` : ""}
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
