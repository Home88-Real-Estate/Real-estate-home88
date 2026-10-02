import Link from "next/link";

import { delta, num, type Flow } from "@/lib/dashboard";

import { Icon, type IconName } from "../Icon";

/**
 * Stat tile: label, value, optional change vs the previous period (arrow +
 * text, never colour alone) and a short context line. Linked tiles open the
 * matching filtered list.
 */
export function Kpi({
  label,
  value,
  icon,
  href,
  flow,
  meta,
}: {
  label: string;
  value: number;
  icon: IconName;
  href?: string;
  flow?: Flow;
  meta?: string;
}) {
  const change = flow ? delta(flow) : null;
  const body = (
    <>
      <span className="kpi__top">
        <span className="kpi__icon" aria-hidden="true">
          <Icon name={icon} size={17} />
        </span>
        <span className="kpi__label">{label}</span>
        {href && <Icon name="chevronRight" size={16} className="kpi__go" />}
      </span>
      <span className="kpi__value">{num(value)}</span>
      {(change || meta) && (
        <span className="kpi__meta">
          {change && (
            <span className={`delta delta--${change.direction}`} title={change.title}>
              {change.direction !== "flat" && (
                <Icon name={change.direction === "up" ? "arrowUp" : "arrowDown"} size={13} />
              )}
              {change.text}
              <span className="sr-only">
                {change.direction === "up" ? " αύξηση" : change.direction === "down" ? " μείωση" : " χωρίς αλλαγή"}
              </span>
            </span>
          )}
          {change && <span>έναντι προηγ. περιόδου</span>}
          {meta && <span>{meta}</span>}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="kpi">
      {body}
    </Link>
  ) : (
    <div className="kpi">{body}</div>
  );
}
