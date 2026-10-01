/**
 * Server-side consent gate.
 *
 * Deliberately a server component: the decision to render a third-party script
 * is made on the server from the consent cookie, so a client-side bug (or a
 * disabled JS bundle) cannot cause a tag to fire without consent. A vendor
 * snippet cannot be pasted into a page; it has to be wrapped here.
 */

import type { ConsentState } from "@/lib/consent";

export function ConsentGate({
  consent,
  purpose,
  children,
}: {
  consent: ConsentState;
  purpose: "analytics" | "marketing" | "session_replay";
  children: React.ReactNode;
}) {
  const granted =
    purpose === "analytics"
      ? consent.analytics
      : purpose === "marketing"
        ? consent.marketing
        : consent.sessionReplay;

  if (!granted) return null;
  return <>{children}</>;
}
