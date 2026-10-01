"use client";

import { archiveProperty } from "@/actions/properties";

export function ArchiveButton({ id }: { id: string }) {
  return (
    <form
      action={archiveProperty}
      onSubmit={(event) => {
        if (!window.confirm("Archive this property? It will be hidden from the website.")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn btn--danger btn--sm">
        Archive
      </button>
    </form>
  );
}
