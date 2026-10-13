import Link from "next/link";

import { countdownText, type SettingsOverview } from "@/lib/settings";

const DAY = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Athens" });

/** Renders only when the subscription data exists and the viewer may see it (the API returns null otherwise). */
export function SubscriptionCard({ subscription }: { subscription: SettingsOverview["subscription"] }) {
  if (!subscription || !subscription.expiresAt) return null;
  const c = subscription.countdown;
  const tone = c?.expired ? "is-expired" : c && c.days < 30 ? "is-soon" : "";
  return (
    <section className={`home-card home-sub ${tone}`} aria-labelledby="home-sub-title">
      <h2 id="home-sub-title">Συνδρομή</h2>
      <p>
        {c?.expired ? "Η συνδρομή σας έχει λήξει στις " : "Η συνδρομή σας λήγει στις "}
        <strong>{DAY.format(new Date(subscription.expiresAt))}</strong>
      </p>
      {c && !c.expired && <p className="hint">{countdownText(c).replace("Η συνδρομή λήγει σε ", "Απομένουν ")}</p>}
      <Link href="/settings" className="home-link">Διαχείριση</Link>
    </section>
  );
}
