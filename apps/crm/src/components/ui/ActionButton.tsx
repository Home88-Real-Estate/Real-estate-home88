"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

import { Icon, type IconName } from "../Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

function classes(variant: ButtonVariant, size: Size, extra?: string, done?: boolean) {
  return ["xbtn", `xbtn--${variant}`, `xbtn--${size}`, done ? "is-done" : "", extra ?? ""].filter(Boolean).join(" ");
}

function Inner({ icon, iconAfter, loading, loadingLabel, done, doneLabel, children }: { icon?: IconName; iconAfter?: IconName; loading?: boolean; loadingLabel?: string; done?: boolean; doneLabel?: string; children: ReactNode }) {
  if (loading) {
    return (
      <>
        <span className="xbtn__spinner" aria-hidden="true" />
        <span>{loadingLabel ?? children}</span>
      </>
    );
  }
  if (done) {
    return (
      <>
        <Icon name="check" size={16} />
        <span>{doneLabel ?? children}</span>
      </>
    );
  }
  return (
    <>
      {icon && <Icon name={icon} size={17} />}
      <span>{children}</span>
      {iconAfter && <Icon name={iconAfter} size={16} className="xbtn__after" />}
    </>
  );
}

/**
 * The intake's button: one look per role (primary, secondary, ghost, danger), with hover, pressed, focus,
 * loading (spinner and its own label, not clickable twice) and a short "done" state for a confirmed save.
 */
export function ActionButton({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  loading,
  loadingLabel,
  done,
  doneLabel,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  loadingLabel?: string;
  done?: boolean;
  doneLabel?: string;
}) {
  return (
    <button {...rest} type={type} className={classes(variant, size, className, done)} disabled={disabled || loading} aria-busy={loading || undefined}>
      <Inner icon={icon} iconAfter={iconAfter} loading={loading} loadingLabel={loadingLabel} done={done} doneLabel={doneLabel}>{children}</Inner>
    </button>
  );
}

export function ActionLink({ variant = "secondary", size = "md", icon, iconAfter, className, children, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: Size; icon?: IconName; iconAfter?: IconName }) {
  return (
    <Link {...rest} className={classes(variant, size, className)}>
      <Inner icon={icon} iconAfter={iconAfter}>{children}</Inner>
    </Link>
  );
}

/** A row of mutually exclusive choices (language) or a single on/off switch styled the same way. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: Array<{ value: T; label: string; icon?: IconName; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="xseg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "xseg__opt is-on" : "xseg__opt"} aria-pressed={o.value === value} disabled={disabled} title={o.title} onClick={() => o.value !== value && onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, icon, disabled, title }: { on: boolean; onChange: (on: boolean) => void; label: ReactNode; icon?: IconName; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={on ? "xtoggle is-on" : "xtoggle"} aria-pressed={on} disabled={disabled} title={title} onClick={() => onChange(!on)}>
      {icon && <Icon name={icon} size={15} />}
      {label}
    </button>
  );
}
