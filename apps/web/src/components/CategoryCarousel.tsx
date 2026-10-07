"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

import { CATEGORIES } from "./CategoryNav";

const SPEED_PX_PER_S = 60;
const RESUME_AFTER_MS = 6000;
const DRAG_THRESHOLD_PX = 6;

/**
 * Continuously moving landing-page carousel built on the existing category
 * card artwork (public/images/categories, 720x456 plus a 480px copy for
 * phones) and the `.catcards`/`.catcard` styles.
 *
 * The track holds one real set of slides plus one clone set. The clone set is
 * aria-hidden and out of the tab order, so screen readers and the tab key
 * still see the four categories exactly once. A transform animation moves both
 * sets at a steady speed and wraps around whenever one set width has passed;
 * because the two sets are identical the wrap is not visible.
 *
 * Hover, focus, mouse-drag and touch pause the motion; it resumes after a
 * short idle period. The arrows and the arrow keys nudge the strip by one
 * card. prefers-reduced-motion disables the continuous motion but keeps the
 * nudges, the keyboard and swiping.
 */
export function CategoryCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);

  const posRef = useRef(0);
  const reducedRef = useRef(false);
  const pauseDepth = useRef(0);
  const holdUntilRef = useRef(0);
  const dimsRef = useRef({ card: 0, step: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startPos: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const mountedRef = useRef(true);

  const wrapPos = useCallback(() => {
    const step = dimsRef.current.step;
    if (step <= 0) return;
    let p = posRef.current;
    while (p <= -step) p += step;
    while (p > 0) p -= step;
    posRef.current = p;
  }, []);

  const applyPos = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const pos = posRef.current;
    track.style.transform = `translate3d(${pos}px,0,0)`;
    track.dataset.pos = String(Math.round(pos));
  }, []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.children.length < 8) return;
    const card = (track.children[1] as HTMLElement).offsetLeft - (track.children[0] as HTMLElement).offsetLeft;
    const step = (track.children[4] as HTMLElement).offsetLeft - (track.children[0] as HTMLElement).offsetLeft;
    dimsRef.current = { card, step };
    wrapPos();
    applyPos();
  }, [wrapPos, applyPos]);

  const pause = useCallback(() => {
    pauseDepth.current += 1;
  }, []);
  const resume = useCallback(() => {
    pauseDepth.current = Math.max(0, pauseDepth.current - 1);
  }, []);

  const nudge = useCallback(
    (dir: 1 | -1) => {
      if (dimsRef.current.card <= 0) return;
      posRef.current += dir * dimsRef.current.card;
      wrapPos();
      applyPos();
      holdUntilRef.current = Date.now() + RESUME_AFTER_MS;
    },
    [wrapPos, applyPos],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = mq.matches;
      applyPos();
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, [applyPos]);

  useEffect(() => {
    mountedRef.current = true;
    let raf = 0;
    let last = -1;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!mountedRef.current) return;
      if (last < 0) last = t;
      const dt = Math.min((t - last) / 1000, 0.5);
      last = t;
      if (reducedRef.current || pauseDepth.current > 0) return;
      if (Date.now() < holdUntilRef.current) return;
      if (dimsRef.current.step <= 0) return;
      posRef.current -= SPEED_PX_PER_S * dt;
      wrapPos();
      applyPos();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(raf);
      applyPos();
    };
  }, [wrapPos, applyPos]);

  useEffect(() => {
    measure();
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge(-1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge(1);
      }
    },
    [nudge],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startPos: posRef.current, moved: false };
      track.setPointerCapture?.(e.pointerId);
      pause();
    },
    [pause],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) drag.moved = true;
      posRef.current = drag.startPos + dx;
      wrapPos();
      applyPos();
    },
    [wrapPos, applyPos],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (drag.moved) {
        suppressClickRef.current = true;
        holdUntilRef.current = Date.now() + RESUME_AFTER_MS;
      }
      resume();
    },
    [resume],
  );

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const slide = (c: (typeof CATEGORIES)[number], clone: boolean) => (
    <Link
      key={c.key}
      href={c.href}
      className="catcard card-slide"
      aria-label={c.label}
      aria-hidden={clone || undefined}
      tabIndex={clone ? -1 : undefined}
      data-clone={clone ? "true" : undefined}
    >
      <img
        src={`/images/categories/${c.image}.webp`}
        srcSet={`/images/categories/${c.image}-480.webp 480w, /images/categories/${c.image}.webp 720w`}
        sizes="(min-width: 1320px) 610px, (min-width: 640px) calc((100vw - 60px) / 2), calc(100vw - 40px)"
        width={720}
        height={456}
        alt=""
        loading={clone ? "lazy" : "eager"}
        decoding="async"
      />
    </Link>
  );

  return (
    <section
      className="wrap catcarousel"
      role="region"
      aria-label="Κατηγορίες ακινήτων"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={resume}
      onClickCapture={onClickCapture}
      onDragStartCapture={(e) => e.preventDefault()}
    >
      <div className="catcarousel__stage">
        <div className="catcarousel__frame">
          <div
            ref={trackRef}
            className="catcards"
            tabIndex={0}
            aria-label="Κατηγορίες ακινήτων"
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {CATEGORIES.map((c) => slide(c, false))}
            {CATEGORIES.map((c) => slide(c, true))}
          </div>
        </div>

        <button
          type="button"
          className="catcarousel__arrow catcarousel__arrow--prev"
          aria-label="Προηγούμενες κατηγορίες"
          onClick={(e) => {
            nudge(1);
            e.currentTarget.blur();
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          className="catcarousel__arrow catcarousel__arrow--next"
          aria-label="Επόμενες κατηγορίες"
          onClick={(e) => {
            nudge(-1);
            e.currentTarget.blur();
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </section>
  );
}