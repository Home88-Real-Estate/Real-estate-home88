import Link from "next/link";

type Category = { key: string; href: string; label: string; image: string };

/**
 * Category strip from the HOME88 reference. Keys map onto the existing
 * `propertyType` search filter, so no new data model or route is introduced.
 */
export const CATEGORIES: Category[] = [
  { key: "APARTMENT", href: "/properties?propertyType=APARTMENT", label: "Κατοικίες", image: "residential" },
  { key: "SHOP", href: "/properties?propertyType=SHOP", label: "Επαγγελματικοί χώροι", image: "commercial" },
  { key: "PLOT", href: "/properties?propertyType=PLOT", label: "Γη", image: "land" },
  { key: "OTHER", href: "/properties", label: "Λοιπά", image: "other" },
];

export function CategoryNav({ active }: { active?: string }) {
  return (
    <nav className="catnav" aria-label="Κατηγορίες ακινήτων">
      {CATEGORIES.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className="catnav__link"
          aria-current={active === c.key ? "page" : undefined}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The same categories as image cards, for the landing page. The artwork
 * carries the icon, label and arrow (public/images/categories, cropped from
 * the HOME88 design at 720x456 plus a 480px copy for phones), so the label
 * reaches screen readers and search engines through aria-label and the image
 * itself is decorative.
 */
export function CategoryCards() {
  return (
    <nav className="catcards wrap" aria-label="Κατηγορίες ακινήτων">
      {CATEGORIES.map((c) => (
        <Link key={c.key} href={c.href} className="catcard" aria-label={c.label}>
          <img
            src={`/images/categories/${c.image}.webp`}
            srcSet={`/images/categories/${c.image}-480.webp 480w, /images/categories/${c.image}.webp 720w`}
            sizes="(min-width: 1320px) 620px, (min-width: 640px) calc(50vw - 40px), calc(100vw - 32px)"
            width={720}
            height={456}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </Link>
      ))}
    </nav>
  );
}
