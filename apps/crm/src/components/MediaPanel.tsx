"use client";

import { MediaItem, type MediaItemData } from "./MediaItem";
import { MediaUploader } from "./MediaUploader";

export function MediaPanel({
  propertyId,
  media,
  canModerate,
}: {
  propertyId: string;
  media: MediaItemData[];
  canModerate: boolean;
}) {
  return (
    <section className="panel">
      <h2>Media ({media.length})</h2>
      <p className="muted">
        Uploads go straight to storage and stay private until a manager approves them. Approved
        photos feed the website and portal listings.
      </p>

      <MediaUploader propertyId={propertyId} />

      {media.length === 0 ? (
        <div className="empty">Δεν έχουν ανέβει αρχεία ακόμη.</div>
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
