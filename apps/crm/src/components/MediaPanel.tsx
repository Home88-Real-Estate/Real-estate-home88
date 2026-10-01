"use client";

import { useActionState } from "react";

import { uploadMedia } from "@/actions/media";
import { idleState } from "@/lib/form";

import { MediaItem, type MediaItemData } from "./MediaItem";

const UPLOAD_KINDS = ["PHOTO", "FLOOR_PLAN", "DOCUMENT", "VIDEO", "VIRTUAL_TOUR"];

export function MediaPanel({
  propertyId,
  media,
  canModerate,
}: {
  propertyId: string;
  media: MediaItemData[];
  canModerate: boolean;
}) {
  const [state, action, pending] = useActionState(uploadMedia, idleState);

  return (
    <section className="panel">
      <h2>Media ({media.length})</h2>
      <p className="muted">
        Uploads are private until a manager approves them. Approved photos feed the website and
        portal listings.
      </p>

      <form action={action} className="media-upload">
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="file" name="file" multiple accept="image/*,application/pdf" />
        <select name="kind" defaultValue="" aria-label="Default kind">
          <option value="">Auto</option>
          {UPLOAD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          {pending ? "Uploading\u2026" : "Upload"}
        </button>
      </form>

      {state.message && (
        <p className={state.ok ? "muted" : "notice notice--danger"}>{state.message}</p>
      )}

      {media.length === 0 ? (
        <div className="empty">No media uploaded yet.</div>
      ) : (
        <div className="media-grid">
          {media.map((item) => (
            <MediaItem
              key={item.id}
              propertyId={propertyId}
              item={item}
              canModerate={canModerate}
            />
          ))}
        </div>
      )}
    </section>
  );
}
