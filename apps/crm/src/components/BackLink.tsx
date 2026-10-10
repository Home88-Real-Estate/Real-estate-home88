"use client";

import { useRouter } from "next/navigation";

import { Icon } from "./Icon";

/** "← Πίσω": to the previous screen when there is one in this tab, otherwise to `fallback`. */
export function BackLink({ fallback, label = "Πίσω" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="xpage-head__back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <Icon name="arrowLeft" size={16} />
      {label}
    </button>
  );
}
