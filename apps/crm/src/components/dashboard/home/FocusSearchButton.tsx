"use client";

import { Icon } from "../../Icon";

export const GLOBAL_SEARCH_ID = "global-search-input";

export function FocusSearchButton() {
  return (
    <button
      type="button"
      className="home-action"
      onClick={() => {
        const input = document.getElementById(GLOBAL_SEARCH_ID) as HTMLInputElement | null;
        input?.focus();
        input?.select();
      }}
    >
      <span className="home-action__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
      <span>Αναζήτηση</span>
    </button>
  );
}
