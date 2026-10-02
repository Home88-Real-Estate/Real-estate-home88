import { CRM_BASE_PATH } from "@/lib/paths";

const COLOR = `${CRM_BASE_PATH}/brand/home88-logo.png`;
const WHITE = `${CRM_BASE_PATH}/brand/home88-logo-white.png`;

/**
 * The HOME88 logo. `white` is for brand/navy surfaces; `auto` shows the
 * colour logo on light themes and the white one on dark (pure CSS, so the
 * right one is visible on first paint).
 */
export function Logo({
  variant = "auto",
  width = 150,
  className,
}: {
  variant?: "auto" | "white";
  width?: number;
  className?: string;
}) {
  const height = Math.round((width * 224) / 640);
  if (variant === "white") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={WHITE} alt="HOME88" width={width} height={height} className={className} />;
  }
  return (
    <span className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={COLOR} alt="HOME88" width={width} height={height} className="logo--on-light" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={WHITE} alt="" aria-hidden="true" width={width} height={height} className="logo--on-dark" />
    </span>
  );
}

export const MARK_WHITE = `${CRM_BASE_PATH}/brand/home88-mark-white.png`;
