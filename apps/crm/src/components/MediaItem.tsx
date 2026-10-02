"use client";

import { useActionState } from "react";

import { deleteMedia, makePrimary, setMediaStatus, updateMedia } from "@/actions/media";
import { idleState } from "@/lib/form";

export type MediaItemData = {
  id: string;
  kind: string;
  url: string;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  altEl: string | null;
  altEn: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
  status: string;
  sortOrder: number;
};

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
};

const KINDS = ["PHOTO", "FLOOR_PLAN", "DOCUMENT", "VIDEO", "VIRTUAL_TOUR"];

function statusClass(status: string): string {
  if (status === "approved" || status === "published") return "badge badge--ok";
  if (status === "rejected") return "badge badge--danger";
  return "badge badge--warn";
}

export function MediaItem({
  propertyId,
  item,
  canModerate,
}: {
  propertyId: string;
  item: MediaItemData;
  canModerate: boolean;
}) {
  const [state, action, pending] = useActionState(updateMedia, idleState);
  const isImage = item.mimeType.startsWith("image/");

  return (
    <div className="media-card">
      <div className="media-thumb">
        {isImage ? (
          // Signed/blob URLs are short-lived and external; next/image adds no value here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl ?? item.url} alt={item.altEl ?? ""} loading="lazy" />
        ) : (
          <span className="mono">{item.mimeType}</span>
        )}
      </div>

      <div className="media-card__row">
        <span className={statusClass(item.status)}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
        {item.isPrimary && <span className="badge">Primary</span>}
      </div>

      <p className="muted media-card__meta">
        {item.kind}
        {item.width && item.height ? ` \u00b7 ${item.width}\u00d7${item.height}` : ""}
        {` \u00b7 ${Math.max(1, Math.round(item.byteSize / 1024))} KB`}
      </p>

      <form action={action}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="mediaId" value={item.id} />
        <input
          name="altEl"
          defaultValue={item.altEl ?? ""}
          placeholder="Alt text (GR)"
          className="input"
        />
        <label className="media-card__label">
          Kind
          <select name="kind" defaultValue={item.kind} className="input">
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn--sm" disabled={pending}>
          {pending ? "Saving\u2026" : "Save"}
        </button>
        {state.message && <span className="media-card__note">{state.message}</span>}
      </form>

      <div className="media-card__actions">
        {!item.isPrimary && (
          <form action={makePrimary}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="mediaId" value={item.id} />
            <button type="submit" className="btn btn--sm">
              Make primary
            </button>
          </form>
        )}
        {canModerate && item.status !== "approved" && (
          <form action={setMediaStatus}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="mediaId" value={item.id} />
            <input type="hidden" name="status" value="approved" />
            <button type="submit" className="btn btn--sm">
              Approve
            </button>
          </form>
        )}
        {canModerate && item.status !== "rejected" && (
          <form action={setMediaStatus}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="mediaId" value={item.id} />
            <input type="hidden" name="status" value="rejected" />
            <button type="submit" className="btn btn--danger btn--sm">
              Reject
            </button>
          </form>
        )}
        <form
          action={deleteMedia}
          onSubmit={(event) => {
            if (!window.confirm("Delete this file?")) event.preventDefault();
          }}
        >
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="mediaId" value={item.id} />
          <button type="submit" className="btn btn--danger btn--sm">
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}
