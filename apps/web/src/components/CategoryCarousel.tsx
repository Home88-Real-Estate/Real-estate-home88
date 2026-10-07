"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

import { CATEGORIES } from "./CategoryNav";

const AUTOPLAY_MS = 4500;
const RESUME_AFTER_MS = 6000;
const DRAG_THRESHOLD_PX = 6;

/**
 * Finite landing-page carousel built on the existing category card artwork
 * (public/images/categories, 720x456 plus a 480px copy for phones) and the
 * `.catcards`/`.catcard` styles. No clone slides are rendered, so content is
 * never shown twice for screen readers. Autoplay keeps moving: it advances
 * from slide to slide and loops back to the first slide after the last.
 * Manual prev/next stay bounded (prev disabled at the start, next at the
 * end). Autoplay pauses on hover, focus, mouse-drag and touch, and resumes
 * after a short idle period. prefers-reduced-motion disables autoplay and
 * animation while keeping the arrows, the keyboard and swiping.
 */
export function CategoryCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState(0);
  const [scrollable, setScrollable] = useState(true);
  const [maxIndex, setMaxIndex] = useState(0);

  const indexRef = useRef(0);
  const maxIndexRef = useRef(0);
  const reducedRef = useRef(false);
  const pauseDepth = useRef(0);
  const holdUntilRef = useRef(0);
  const stepRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startLeft: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const autoplayRef = useRef<{ restart: () => void } | null>(null);
  const mountedRef = useRef(true);

  const pause = useCallback(() => {
    pauseDepth.current += 1;
  }, []);
  const resume = useCallback(() => {
    pauseDepth.current = Math.max(0, pauseDepth.current - 1);
  }, []);

  const getStep = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.children.length < 2) return 0;
    const step =
      (track.children[1] as HTMLElement).offsetLeft - (track.children[0] as HTMLElement).offsetLeft;
    stepRef.current = step;
    return step;
  }, []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const step = getStep();
    const maxScroll = track.scrollWidth - track.clientWidth;
    const maxIndex = step > 0 ? Math.max(0, Math.round(maxScroll / step)) : 0;
    maxIndexRef.current = maxIndex;
    setMaxIndex(maxIndex);
    setScrollable(maxScroll > 1);
  }, [getStep]);

  const scrollToIndex = useCallback(
    (next: number) => {
      const track = trackRef.current;
      if (!track) return;
      const step = stepRef.current > 0 ? stepRef.current : getStep();
      if (step <= 0) return;
      track.scrollTo({ left: next * step, behavior: reducedRef.current ? "auto" : "smooth" });
      indexRef.current = next;
      setIndex(next);
    },
    [getStep],
  );

  const goPrev = useCallback(() => {
    const i = indexRef.current;
    if (i <= 0) return;
    holdUntilRef.current = Date.now() + RESUME_AFTER_MS;
    scrollToIndex(i - 1);
    autoplayRef.current?.restart();
  }, [scrollToIndex]);

  const goNext = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.scrollWidth <= track.clientWidth + 1) return;
    const i = indexRef.current;
    if (i >= maxIndexRef.current) return;
    holdUntilRef.current = Date.now() + RESUME_AFTER_MS;
    scrollToIndex(i + 1);
    autoplayRef.current?.restart();
  }, [scrollToIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = mq.matches;
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delay = AUTOPLAY_MS) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };
    function tick() {
      timer = null;
      if (!mountedRef.current) return;
      if (reducedRef.current || pauseDepth.current > 0) {
        schedule();
        return;
      }
      const wait = holdUntilRef.current - Date.now();
      if (wait > 0) {
        schedule(wait);
        return;
      }
      const track = trackRef.current;
      if (!track || track.scrollWidth <= track.clientWidth + 1) return;
      if (indexRef.current >= maxIndexRef.current) {
        scrollToIndex(0);
      } else {
        scrollToIndex(indexRef.current + 1);
      }
      schedule();
    }
    autoplayRef.current = { restart: schedule };
    schedule();
    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [scrollToIndex]);

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

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.children.length < 2) return;
    const step = stepRef.current > 0 ? stepRef.current : getStep();
    if (step <= 0) return;
    const i = Math.max(0, Math.min(Math.round(track.scrollLeft / step), maxIndexRef.current));
    if (i !== indexRef.current) {
      indexRef.current = i;
      setIndex(i);
    }
  }, [getStep]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    },
    [goNext, goPrev],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const track = trackRef.current;
    if (!track) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startLeft: track.scrollLeft, moved: false };
    track.setPointerCapture?.(e.pointerId);
    pause();
  }, [pause]);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || !track || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX) drag.moved = true;
    track.scrollLeft = drag.startLeft - dx;
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (drag.moved) {
        suppressClickRef.current = true;
        holdUntilRef.current = Date.now() + RESUME_AFTER_MS;
        autoplayRef.current?.restart();
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

  const onTouchStart = useCallback(() => {
    pause();
  }, [pause]);

  const onTouchEnd = useCallback(() => {
    holdUntilRef.current = Date.now() + RESUME_AFTER_MS;
    resume();
    autoplayRef.current?.restart();
  }, [resume]);

  const canPrev = index > 0;
  const canNext = scrollable && index < maxIndex;

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
        <div
          ref={trackRef}
          className="catcards"
          tabIndex={0}
          aria-label="Κατηγορίες ακινήτων"
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {CATEGORIES.map((c) => (
            <Link key={c.key} href={c.href} className="catcard card-slide" aria-label={c.label}>
              <img
                src={`/images/categories/${c.image}.webp`}
                srcSet={`/images/categories/${c.image}-480.webp 480w, /images/categories/${c.image}.webp 720w`}
                sizes="(min-width: 1320px) 610px, (min-width: 640px) calc((100vw - 60px) / 2), calc(100vw - 40px)"
                width={720}
                height={456}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </Link>
          ))}
        </div>

        <button
          type="button"
          className="catcarousel__arrow catcarousel__arrow--prev"
          aria-label="Προηγούμενες κατηγορίες"
          onClick={goPrev}
          disabled={!canPrev}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          className="catcarousel__arrow catcarousel__arrow--next"
          aria-label="Επόμενες κατηγορίες"
          onClick={goNext}
          disabled={!canNext}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </section>
  );
}