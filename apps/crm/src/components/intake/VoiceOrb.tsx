"use client";

import { useEffect, useRef } from "react";

import { Icon } from "../Icon";

/** One state at a time for the microphone; the screen never shows two that contradict each other. */
export type MicState = "idle" | "requesting_permission" | "recording" | "processing" | "transcript_ready" | "error";

const STATUS: Record<MicState, { title: string; sub: string }> = {
  idle: { title: "Πατήστε για να ξεκινήσετε", sub: "ή πληκτρολογήστε. Ο λόγος σας γίνεται κείμενο που ελέγχετε πριν σταλεί." },
  requesting_permission: { title: "Επιτρέψτε το μικρόφωνο…", sub: "Ο browser ζητά άδεια για να ακούσει." },
  recording: { title: "Ακούω…", sub: "Πατήστε ξανά όταν τελειώσετε." },
  processing: { title: "Επεξεργασία…", sub: "Μετατροπή της ομιλίας σε κείμενο." },
  transcript_ready: { title: "Το κείμενο είναι έτοιμο", sub: "Ελέγξτε το, διορθώστε ό,τι χρειάζεται και στείλτε το." },
  error: { title: "Η ηχογράφηση δεν ολοκληρώθηκε", sub: "" },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Lines either side of the orb. While recording they follow the real microphone signal (read locally, never
 * sent); otherwise they rest as a faint, still curve. Drawn on a canvas, outside React state, so the page does
 * not re-render on every frame; with reduced motion the drawing runs at a calm ten frames a second.
 */
function Waveform({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levelTarget = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    levelTarget.current = el.closest(".vorb");
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let timer = 0;
    let audio: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const fit = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.max(1, Math.round(el.clientWidth * ratio));
      el.height = Math.max(1, Math.round(el.clientHeight * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(() => {
      fit();
      if (!analyser) draw(null, 0);
    });
    ro.observe(el);

    const colors = () => {
      const css = getComputedStyle(el);
      return [css.getPropertyValue("--vorb-line-1").trim() || "#1677FF", css.getPropertyValue("--vorb-line-2").trim() || "#50DFFF", css.getPropertyValue("--vorb-line-3").trim() || "#8AB4FF"];
    };

    function draw(samples: Uint8Array | null, level: number) {
      const w = el!.clientWidth;
      const h = el!.clientHeight;
      ctx!.clearRect(0, 0, w, h);
      const mid = h / 2;
      const gap = Math.min(110, w * 0.16); // keep the orb itself clear
      const palette = colors();
      [0.9, 0.6, 0.35].forEach((weight, line) => {
        ctx!.beginPath();
        ctx!.lineWidth = line === 0 ? 1.6 : 1.1;
        ctx!.strokeStyle = palette[line]!;
        ctx!.globalAlpha = samples ? 0.85 - line * 0.2 : 0.35 - line * 0.08;
        for (let x = 0; x <= w; x += 3) {
          const fromCentre = Math.abs(x - w / 2);
          const fade = fromCentre < gap ? 0 : Math.min(1, (fromCentre - gap) / (w / 2 - gap)) * Math.sin(Math.min(1, (w / 2 - fromCentre) / (w / 2 - gap) + 0.15) * Math.PI);
          let y: number;
          if (samples) {
            const i = Math.floor((x / w) * samples.length);
            const v = (samples[i]! - 128) / 128;
            y = mid + v * h * 0.42 * weight * fade + Math.sin(x / 38 + line) * 4 * level * fade;
          } else {
            y = mid + Math.sin(x / (46 + line * 9) + line * 1.7) * h * 0.08 * weight * fade;
          }
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.stroke();
      });
      ctx!.globalAlpha = 1;
    }

    if (active && stream) {
      try {
        audio = new AudioContext();
        analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        audio.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const frame = () => {
          analyser!.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
          levelTarget.current?.style.setProperty("--level", level.toFixed(3));
          draw(data, level);
        };
        if (reduced) timer = window.setInterval(frame, 100);
        else {
          const loop = () => {
            frame();
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
        }
      } catch {
        draw(null, 0);
      }
    } else {
      levelTarget.current?.style.setProperty("--level", "0");
      draw(null, 0);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      ro.disconnect();
      void audio?.close().catch(() => undefined);
    };
  }, [stream, active]);

  return <canvas ref={canvas} className="vorb__wave" aria-hidden="true" />;
}

/** The microphone: one big control whose look always matches what the microphone is really doing. */
export function VoiceOrb({
  state,
  stream,
  seconds,
  maxSeconds,
  thinking,
  handsFree,
  disabled,
  errorText,
  onPress,
}: {
  state: MicState;
  stream: MediaStream | null;
  seconds: number;
  maxSeconds: number;
  /** The assistant is working on a sent message (not the microphone). */
  thinking: boolean;
  handsFree: boolean;
  disabled?: boolean;
  errorText?: string | null;
  onPress: () => void;
}) {
  const recording = state === "recording";
  const busy = state === "processing" || state === "requesting_permission";
  const status = thinking && !recording && !busy ? { title: "Ο βοηθός ενημερώνει την καταχώριση…", sub: "Συμπληρώνει τα στοιχεία από όσα είπατε." } : STATUS[state];
  const label = recording ? "Τέλος ηχογράφησης" : busy ? status.title : "Έναρξη ηχογράφησης";
  return (
    <div className="vorb" data-state={state} data-thinking={thinking || undefined}>
      <div className="vorb__stage">
        <Waveform stream={stream} active={recording} />
        <button type="button" className="vorb__orb" onClick={onPress} disabled={disabled || busy} aria-pressed={recording} aria-label={label}>
          <span className="vorb__ring vorb__ring--outer" aria-hidden="true" />
          <span className="vorb__ring vorb__ring--inner" aria-hidden="true" />
          <span className="vorb__core" aria-hidden="true">
            {busy ? <span className="vorb__spinner" /> : <Icon name={recording ? "stop" : "mic"} size={recording ? 26 : 34} />}
          </span>
        </button>
      </div>
      <div className="vorb__status" role="status" aria-live="polite">
        <p className="vorb__title">
          {status.title}
          {recording && <span className="vorb__time"> {clock(seconds)}<span className="sr-only"> λεπτά</span> / {clock(maxSeconds)}</span>}
        </p>
        <p className="vorb__sub">{state === "error" ? errorText : recording && handsFree ? "Σταματώ μόνος μου μόλις κάνετε παύση." : status.sub}</p>
      </div>
    </div>
  );
}
