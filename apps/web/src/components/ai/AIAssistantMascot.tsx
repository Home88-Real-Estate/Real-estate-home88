"use client";

/**
 * The HOME88 fox.
 *
 * The supplied artwork is a raster image, so nothing here redraws or distorts
 * the fox. It is shown as-is, and only the eyes are animated, as a separate
 * layer: each eye is the same artwork clipped to the iris and moved inside a
 * mask of the eye opening, over a plain sclera that covers the painted iris.
 * Head turn and breathing are small transforms on the whole figure.
 *
 * Cursor following runs on requestAnimationFrame and writes to refs and CSS
 * custom properties; it never sets React state, so moving the mouse does not
 * re-render anything. The loop only runs while the cursor is moving or the
 * eyes are still easing, and not at all under prefers-reduced-motion.
 */

import { useEffect, useId, useRef } from "react";

export type MascotState = "idle" | "hover" | "opening" | "listening" | "thinking" | "responding" | "success" | "error";

export type MascotTuning = {
  /** Largest eye travel as a fraction of the iris radius's range, in artwork pixels. */
  eyeMaxX: number;
  eyeMaxY: number;
  /** Degrees. Kept small: the effect should be noticed, not seen. */
  headMaxRotation: number;
  /** 0–1 easing per frame; higher is snappier. */
  animationSpeed: number;
};

export const DEFAULT_TUNING: MascotTuning = { eyeMaxX: 9, eyeMaxY: 6, headMaxRotation: 3, animationSpeed: 0.14 };

const ART = "/images/fox/home88-fox-assistant.webp";
const ART_SIZE = 1254;
/** Crop of the artwork that holds the fox, in artwork pixels. */
const VIEW = "160 115 970 980";

/** Eye geometry in artwork pixels: the opening (clip), the iris, and a sclera cover slightly larger than the iris. */
const EYES = [
  {
    id: "l",
    opening: "442,597 467,562 500,552 533,560 563,613 547,630 510,636 467,631",
    iris: { cx: 497, cy: 594, rx: 38, ry: 40 },
    cover: { cx: 497, cy: 594, rx: 46, ry: 48 },
  },
  {
    id: "r",
    opening: "655,518 667,490 700,478 733,497 738,530 713,563 687,577 663,557",
    iris: { cx: 683, cy: 537, rx: 30, ry: 41 },
    cover: { cx: 683, cy: 537, rx: 38, ry: 49 },
  },
] as const;

export function AIAssistantMascot({
  state = "idle",
  size = 96,
  track = true,
  tuning,
  className,
}: {
  state?: MascotState;
  size?: number;
  track?: boolean;
  tuning?: Partial<MascotTuning>;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const figureRef = useRef<HTMLDivElement>(null);
  const irisRefs = useRef<Array<SVGGElement | null>>([]);
  const lidRefs = useRef<Array<SVGPolygonElement | null>>([]);
  const t = { ...DEFAULT_TUNING, ...tuning };
  const tuningRef = useRef(t);
  tuningRef.current = t;

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };
    let frame = 0;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      const p = tuningRef.current;
      irisRefs.current.forEach((g) => g?.setAttribute("transform", `translate(${(current.x * p.eyeMaxX).toFixed(2)} ${(current.y * p.eyeMaxY).toFixed(2)})`));
      figure.style.setProperty("--fox-rot", `${(current.x * p.headMaxRotation).toFixed(2)}deg`);
      figure.style.setProperty("--fox-tilt-y", `${(current.y * -1.2).toFixed(2)}px`);
    };

    const tick = () => {
      const k = tuningRef.current.animationSpeed;
      current = { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k };
      apply();
      const settled = Math.abs(target.x - current.x) < 0.003 && Math.abs(target.y - current.y) < 0.003;
      frame = settled ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => { if (!frame) frame = requestAnimationFrame(tick); };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = figure.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.45);
      // Saturate with distance so far-away cursors give the full, gentle look rather than a spin.
      const reach = Math.max(r.width, 120) * 2.2;
      target = { x: Math.max(-1, Math.min(1, dx / reach)), y: Math.max(-1, Math.min(1, dy / reach)) };
      kick();
    };
    const onLeave = () => { target = { x: 0, y: 0 }; kick(); };

    const blink = () => {
      lidRefs.current.forEach((l) => l?.setAttribute("opacity", "1"));
      setTimeout(() => lidRefs.current.forEach((l) => l?.setAttribute("opacity", "0")), 120);
      blinkTimer = setTimeout(blink, 2600 + Math.random() * 3600);
    };
    blinkTimer = setTimeout(blink, 1800);

    if (track) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      window.addEventListener("blur", onLeave);
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      if (frame) cancelAnimationFrame(frame);
      if (blinkTimer) clearTimeout(blinkTimer);
    };
  }, [track]);

  return (
    <div ref={figureRef} className={`fox ${className ?? ""}`} data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <div className="fox__body">
        <svg viewBox={VIEW} width="100%" height="100%" focusable="false">
          <defs>
            {EYES.map((e) => (
              <g key={e.id}>
                <clipPath id={`${uid}-open-${e.id}`}><polygon points={e.opening} /></clipPath>
                <clipPath id={`${uid}-iris-${e.id}`}><ellipse {...e.iris} /></clipPath>
                <radialGradient id={`${uid}-sclera-${e.id}`} cx="50%" cy="55%" r="60%">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.7" stopColor="#f6f1ec" />
                  <stop offset="1" stopColor="#d9cfc7" />
                </radialGradient>
                <radialGradient id={`${uid}-lid-${e.id}`} cx="50%" cy="50%" r="60%">
                  <stop offset="0" stopColor="#f2822a" />
                  <stop offset="1" stopColor="#d9631a" />
                </radialGradient>
              </g>
            ))}
          </defs>

          <image href={ART} x="0" y="0" width={ART_SIZE} height={ART_SIZE} />

          {EYES.map((e, i) => (
            <g key={e.id} clipPath={`url(#${uid}-open-${e.id})`}>
              <ellipse {...e.cover} fill={`url(#${uid}-sclera-${e.id})`} />
              <g ref={(el) => { irisRefs.current[i] = el; }}>
                <g clipPath={`url(#${uid}-iris-${e.id})`}>
                  <image href={ART} x="0" y="0" width={ART_SIZE} height={ART_SIZE} />
                </g>
              </g>
              <polygon ref={(el) => { lidRefs.current[i] = el; }} points={e.opening} fill={`url(#${uid}-lid-${e.id})`} opacity="0" style={{ transition: "opacity 50ms" }} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
