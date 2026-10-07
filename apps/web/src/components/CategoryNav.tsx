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


