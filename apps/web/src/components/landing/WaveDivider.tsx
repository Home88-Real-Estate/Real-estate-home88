import type { CSSProperties } from "react";

/**
 * Decorative liquid edge between a section and the one that follows.
 *
 * Three layers in one small SVG, each drifting on its own slow, alternating
 * timeline (no reset point):
 *   back      – a wider, paler swell in the brand's light blue
 *   main      – the solid edge; its colour is the next surface, so the wave
 *               becomes that surface with no seam
 *   highlight – a thin line just inside the main crest, like light on glass
 *
 * The paths are drawn wider than the view box so the drift never shows an
 * end. Motion is transform-only and switches off under reduced motion; the
 * shapes stay. Purely decorative: hidden from assistive tech, never
 * focusable, never in the way of a click.
 */
export type WaveDividerProps = {
  /** "top" rises out of the top edge of the next surface (e.g. the footer). */
  position?: "top" | "bottom";
  /** Height of the band: "subtle" is shallower. */
  intensity?: "subtle" | "medium";
  /** Colour of the surface the wave turns into. Defaults to the footer navy. */
  primary?: string;
  secondary?: string;
  highlight?: string;
  className?: string;
};

export function WaveDivider({
  position = "top",
  intensity = "medium",
  primary,
  secondary,
  highlight,
  className,
}: WaveDividerProps) {
  const style = {
    ...(primary ? { "--wave-primary": primary } : {}),
    ...(secondary ? { "--wave-secondary": secondary } : {}),
    ...(highlight ? { "--wave-highlight": highlight } : {}),
  } as CSSProperties;

  return (
    <div
      className={["wave-divider", `wave-divider--${position}`, `wave-divider--${intensity}`, className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1440 120" preserveAspectRatio="none" focusable="false">
        <path
          className="wave-divider__back"
          d="M-120 58C110 34 330 26 540 40S880 76 1080 62 1390 30 1560 40V120H-120Z"
        />
        <path
          className="wave-divider__main"
          d="M-120 80C80 62 240 46 420 56S700 92 890 84 1140 54 1300 52 1500 64 1560 70V120H-120Z"
        />
        <path
          className="wave-divider__highlight"
          d="M-120 89C80 71 240 55 420 65S700 101 890 93 1140 63 1300 61 1500 73 1560 79"
        />
      </svg>
    </div>
  );
}
