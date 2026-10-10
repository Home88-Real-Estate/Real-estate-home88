"use client";

import { useRef } from "react";

import { logoutAction } from "@/actions/auth";
import { logoutWarning, unsyncedSummary, wipeLocalData } from "@/lib/local-data";

import { Icon } from "./Icon";

/**
 * Logout that also clears what this device keeps for offline work (drafts, photos waiting to upload,
 * unsent text, cached app files), after warning about anything that has not reached the server.
 */
export function LogoutButton() {
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  return (
    <form
      ref={form}
      action={logoutAction}
      onSubmit={(e) => {
        if (confirmed.current) return;
        e.preventDefault();
        void (async () => {
          const warning = logoutWarning(await unsyncedSummary().catch(() => ({ drafts: 0, photos: 0 })));
          if (warning && !window.confirm(warning)) return;
          await wipeLocalData().catch(() => undefined);
          confirmed.current = true;
          form.current?.requestSubmit();
        })();
      }}
    >
      <button type="submit">
        <Icon name="logout" size={16} /> Αποσύνδεση
      </button>
    </form>
  );
}
