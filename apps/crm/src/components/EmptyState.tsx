import Link from "next/link";

/** A friendly, explicit empty state: never a blank table. */
export function EmptyState({
  title,
  text,
  action,
  compact = false,
}: {
  title: string;
  text?: string;
  action?: { href: string; label: string };
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty empty--compact" : "empty"}>
      <p className="empty__title">{title}</p>
      {text && <p className="empty__text">{text}</p>}
      {action && (
        <Link href={action.href} className="btn btn--primary btn--sm">
          {action.label}
        </Link>
      )}
    </div>
  );
}
