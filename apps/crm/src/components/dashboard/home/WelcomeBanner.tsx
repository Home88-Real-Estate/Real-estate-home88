import { CRM_BASE_PATH } from "@/lib/paths";

/**
 * Welcome banner. Decorative image on the right, text on a solid gradient on the left so contrast never depends
 * on the picture. Kept short (see .home-banner) so the business information stays above the fold.
 */
export function WelcomeBanner({ greeting, name, date }: { greeting: string; name: string; date: string }) {
  return (
    <section className="home-banner" aria-label="Καλωσήρθατε">
      <div className="home-banner__text">
        <p className="home-banner__eyebrow">{date}</p>
        <h1>
          Καλωσήρθατε πίσω, {name}!
        </h1>
        <p className="home-banner__sub">Διαχειριστείτε εύκολα τις επαφές, τα ακίνητα και τις συναλλαγές σας.</p>
        <span className="sr-only">{greeting}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="home-banner__img" src={`${CRM_BASE_PATH}/brand/dashboard-fox-villa.webp`} alt="" width={960} height={540} decoding="async" />
    </section>
  );
}
