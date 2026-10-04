"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Photo (and optional document) uploader for the public owner form.
 *
 * Files go straight from the browser to private object storage through signed
 * URLs, so a large phone photo never passes through a serverless request. The
 * visitor needs no account: an anonymous upload session is created on first use.
 * Nothing uploaded here is public; it is reviewed by staff first, and the page
 * says so.
 *
 * Behaviour: drag and drop or pick files (camera or gallery on a phone),
 * thumbnails, per-file progress with retry, remove, and reorder.
 */

export type UploadedFile = { storageKey: string; kind: "PHOTO" | "DOCUMENT"; fileName: string; mimeType: string; byteSize: number };
export type UploaderValue = { token: string | null; files: UploadedFile[]; busy: boolean };

type Item = {
  id: string;
  file: File;
  kind: "PHOTO" | "DOCUMENT";
  preview: string | null;
  state: "queued" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  uploaded?: UploadedFile;
};

type SessionInfo = { token: string; limits: { maxPhotos: number; maxDocuments: number; maxPhotoBytes: number; maxDocumentBytes: number } };

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function putWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

export function PhotoUploader({ onChange, allowDocuments = true }: { onChange: (value: UploaderValue) => void; allowDocuments?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const session = useRef<SessionInfo | null>(null);
  const sessionPromise = useRef<Promise<SessionInfo> | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange({
      token: session.current?.token ?? null,
      files: items.filter((i) => i.state === "done" && i.uploaded).map((i) => i.uploaded!),
      busy: items.some((i) => i.state === "queued" || i.state === "uploading"),
    });
  }, [items, onChange]);

  useEffect(() => () => items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureSession = useCallback(async (): Promise<SessionInfo> => {
    if (session.current) return session.current;
    sessionPromise.current ??= fetch("/api/uploads/session", { method: "POST" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.token) throw new Error(body?.message ?? "Η μεταφόρτωση δεν είναι διαθέσιμη αυτή τη στιγμή.");
      session.current = { token: body.token, limits: body.limits };
      return session.current;
    });
    return sessionPromise.current;
  }, []);

  const update = (id: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const upload = useCallback(
    async (item: Item) => {
      update(item.id, { state: "uploading", progress: 0, error: undefined });
      try {
        const s = await ensureSession();
        const res = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: s.token, kind: item.kind, fileName: item.file.name, mimeType: item.file.type, byteSize: item.file.size }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.message ?? "Το αρχείο δεν έγινε δεκτό.");
        await putWithProgress(body.upload.url, body.upload.headers, item.file, (p) => update(item.id, { progress: p }));
        update(item.id, {
          state: "done",
          progress: 1,
          uploaded: { storageKey: body.storageKey, kind: item.kind, fileName: item.file.name, mimeType: item.file.type, byteSize: item.file.size },
        });
      } catch (e) {
        update(item.id, { state: "error", error: e instanceof Error ? e.message : "Η μεταφόρτωση απέτυχε." });
      }
    },
    [ensureSession],
  );

  const add = useCallback(
    (files: FileList | File[], kind: "PHOTO" | "DOCUMENT") => {
      setNotice(null);
      const allowed = kind === "PHOTO" ? PHOTO_TYPES : DOC_TYPES;
      const accepted: Item[] = [];
      for (const file of Array.from(files)) {
        if (!allowed.includes(file.type)) {
          setNotice(kind === "PHOTO" ? "Επιτρέπονται μόνο φωτογραφίες JPG, PNG ή WEBP." : "Επιτρέπονται μόνο PDF, JPG ή PNG.");
          continue;
        }
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          kind,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
          state: "queued",
          progress: 0,
        });
      }
      if (accepted.length === 0) return;
      setItems((cur) => [...cur, ...accepted]);
      accepted.forEach((item) => void upload(item));
    },
    [upload],
  );

  const remove = (id: string) =>
    setItems((cur) => {
      const gone = cur.find((i) => i.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return cur.filter((i) => i.id !== id);
    });

  const move = (id: string, delta: number) =>
    setItems((cur) => {
      const photos = cur.filter((i) => i.kind === "PHOTO");
      const from = photos.findIndex((i) => i.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= photos.length) return cur;
      const reordered = [...photos];
      [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
      return [...reordered, ...cur.filter((i) => i.kind !== "PHOTO")];
    });

  const photos = items.filter((i) => i.kind === "PHOTO");
  const docs = items.filter((i) => i.kind === "DOCUMENT");
  const done = items.filter((i) => i.state === "done").length;

  return (
    <fieldset className="uploader">
      <legend>Φωτογραφίες ακινήτου</legend>
      <p className="hint">Προσθέστε φωτογραφίες του ακινήτου σας. Οι φωτογραφίες θα παραμείνουν ιδιωτικές μέχρι να αξιολογηθούν από τη HOME88.</p>

      <div
        className={dragging ? "uploader__drop is-over" : "uploader__drop"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files, "PHOTO");
        }}
      >
        <p>Σύρετε φωτογραφίες εδώ</p>
        <button type="button" className="btn btn--sm" onClick={() => photoInput.current?.click()}>
          Επιλέξτε αρχεία
        </button>
        <p className="hint">JPG / PNG / WEBP</p>
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => e.target.files && add(e.target.files, "PHOTO")} />
      </div>

      {notice && <p className="error" role="alert">{notice}</p>}

      {photos.length > 0 && (
        <ul className="uploader__list" aria-label="Φωτογραφίες">
          {photos.map((item, index) => (
            <li key={item.id} className={`uploader__item is-${item.state}`}>
              {item.preview && <img src={item.preview} alt="" width={72} height={72} />}
              <div className="uploader__meta">
                <span className="uploader__name">{item.file.name}</span>
                <span className="hint">{mb(item.file.size)}</span>
                {item.state === "uploading" && <progress value={item.progress} max={1} aria-label={`Μεταφόρτωση ${item.file.name}`} />}
                {item.state === "done" && <span className="hint">✓ Ανέβηκε</span>}
                {item.state === "error" && (
                  <span className="error">
                    {item.error}{" "}
                    <button type="button" className="linkbtn" onClick={() => void upload(item)}>Επανάληψη</button>
                  </span>
                )}
              </div>
              <div className="uploader__actions">
                <button type="button" className="btn btn--sm" onClick={() => move(item.id, -1)} disabled={index === 0} aria-label="Μετακίνηση πάνω">↑</button>
                <button type="button" className="btn btn--sm" onClick={() => move(item.id, 1)} disabled={index === photos.length - 1} aria-label="Μετακίνηση κάτω">↓</button>
                <button type="button" className="btn btn--sm" onClick={() => remove(item.id)} aria-label={`Αφαίρεση ${item.file.name}`}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {allowDocuments && (
        <div className="uploader__docs">
          <p className="fieldlabel">Έγγραφα ακινήτου (προαιρετικά)</p>
          <p className="hint">Π.χ. τίτλος ιδιοκτησίας, κάτοψη, ενεργειακό πιστοποιητικό. Τα έγγραφα είναι ιδιωτικά και δεν δημοσιεύονται ποτέ.</p>
          <button type="button" className="btn btn--sm" onClick={() => docInput.current?.click()}>Προσθήκη εγγράφου</button>
          <input ref={docInput} type="file" accept="application/pdf,image/jpeg,image/png" multiple hidden onChange={(e) => e.target.files && add(e.target.files, "DOCUMENT")} />
          {docs.length > 0 && (
            <ul className="uploader__list" aria-label="Έγγραφα">
              {docs.map((item) => (
                <li key={item.id} className={`uploader__item is-${item.state}`}>
                  <div className="uploader__meta">
                    <span className="uploader__name">{item.file.name}</span>
                    <span className="hint">{mb(item.file.size)}</span>
                    {item.state === "uploading" && <progress value={item.progress} max={1} />}
                    {item.state === "done" && <span className="hint">✓ Ανέβηκε</span>}
                    {item.state === "error" && (
                      <span className="error">{item.error} <button type="button" className="linkbtn" onClick={() => void upload(item)}>Επανάληψη</button></span>
                    )}
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => remove(item.id)} aria-label={`Αφαίρεση ${item.file.name}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {items.length > 0 && (
        <p className="hint" role="status">
          {done}/{items.length} αρχεία ανέβηκαν
        </p>
      )}
    </fieldset>
  );
}
