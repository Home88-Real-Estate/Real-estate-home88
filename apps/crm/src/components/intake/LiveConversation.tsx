"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { ActionButton } from "@/components/ui/ActionButton";
import { intakeApi, type IntakeSession } from "@/lib/intake-client";
import { BrowserLiveAudio, liveAudioSupported } from "@/lib/live-audio";
import { LiveConversation as Controller, type LiveState, type LiveView, type SocketLike } from "@/lib/live-session";

import { Waveform } from "./VoiceOrb";

const STATUS: Record<LiveState, { title: string; sub: string }> = {
  idle: { title: "Έτοιμος για συνομιλία", sub: "Πατήστε «Έναρξη συνομιλίας» και μιλήστε φυσικά. Ο βοηθός σας απαντά φωνητικά και ρωτά ό,τι λείπει." },
  connecting: { title: "Σύνδεση…", sub: "Ζητείται το μικρόφωνο και συνδέεται ο βοηθός." },
  listening: { title: "Σας ακούω", sub: "Μιλήστε φυσικά. Μπορείτε να διορθώσετε ό,τι είπατε, όποτε θέλετε." },
  user_speaking: { title: "Σας ακούω…", sub: "Όταν κάνετε παύση, ο βοηθός απαντά." },
  thinking: { title: "Ο βοηθός σκέφτεται…", sub: "Ελέγχει και καταχωρεί τα στοιχεία." },
  speaking: { title: "Μιλάει ο βοηθός", sub: "Μπορείτε να τον διακόψετε μιλώντας." },
  waiting: { title: "Περιμένω την απάντησή σας", sub: "Μιλήστε ή γράψτε παρακάτω." },
  reconnecting: { title: "Επανασύνδεση…", sub: "Ό,τι καταγράφηκε είναι αποθηκευμένο." },
  disconnected: { title: "Η σύνδεση διακόπηκε", sub: "" },
  error: { title: "Η συνομιλία δεν ξεκίνησε", sub: "" },
  ended: { title: "Η συνομιλία τελείωσε", sub: "Ελέγξτε τα στοιχεία δίπλα (ή παρακάτω στο κινητό), διορθώστε ό,τι χρειάζεται και αποθηκεύστε το πρόχειρο." },
};

const ACTIVE: LiveState[] = ["connecting", "listening", "user_speaking", "thinking", "speaking", "waiting", "reconnecting"];

/** What the orb shows, in the classes the recording orb already has. */
function orbState(state: LiveState, muted: boolean): string {
  if (state === "error" || state === "disconnected") return "error";
  if (state === "speaking") return "speaking";
  if ((state === "listening" || state === "user_speaking" || state === "waiting") && !muted) return "recording";
  return "idle";
}

/**
 * Owns the conversation (controller, microphone and speaker, transcript) for the whole page. The panel can be
 * re-mounted (the page changes layout when the first draft is created, which happens on the very tap that
 * starts the conversation) without ending or restarting it.
 */
export class LiveStore {
  view: LiveView = { state: "idle", lines: [], muted: false, error: null, last: null, reviewSuggested: false };
  stream: MediaStream | null = null;
  onSession: (session: IntakeSession) => void = () => undefined;
  private controller: Controller | null = null;
  private audio: BrowserLiveAudio | null = null;
  private wake: { release(): Promise<void> } | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async keepAwake(on: boolean) {
    try {
      const api = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (on && api && !this.wake) this.wake = await api.request("screen");
      if (!on) {
        await this.wake?.release();
        this.wake = null;
      }
    } catch {
      // The screen may still turn off; the conversation reconnects if it drops.
    }
  }

  /** Call from the tap itself: the speaker is unlocked synchronously, before anything is awaited. */
  start(ensureSession: () => Promise<IntakeSession | null>) {
    if (!this.audio) {
      this.audio = new BrowserLiveAudio();
      this.audio.onStream = (stream) => {
        this.stream = stream;
        this.emit();
      };
    }
    this.audio.unlock();
    void (async () => {
      const session = await ensureSession();
      if (!session) return;
      const c = new Controller({
        token: (handle) => intakeApi.liveToken(session.id, handle),
        sync: (body) => intakeApi.liveSync(session.id, body),
        openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        audio: this.audio!,
        onChange: (view) => {
          this.view = view;
          this.emit();
        },
        onSession: (next) => this.onSession(next),
      });
      this.controller = c;
      void this.keepAwake(true);
      await c.start();
    })();
  }

  retry() {
    return this.controller?.retry();
  }

  setMuted(muted: boolean) {
    this.controller?.setMuted(muted);
  }

  sendText(text: string): boolean {
    return this.controller?.sendText(text) ?? false;
  }

  async stop() {
    await this.controller?.stop();
    void this.keepAwake(false);
  }

  /** The page is going away: end the conversation and release the microphone and speaker. */
  dispose() {
    void this.stop();
    this.audio?.close();
    this.audio = null;
  }
}

/**
 * A spoken, two-way conversation with the assistant (Gemini Live). The conversation itself runs in the browser;
 * every fact it reports is validated by the server before it appears in the summary. Recording-and-send and
 * typing remain one tap away, and everything already recorded stays if the connection drops.
 */
export function LiveConversation({
  store,
  ensureSession,
  onSession,
  onUseRecorder,
  onUseText,
  onReview,
  onEnded,
  disabled,
}: {
  store: LiveStore;
  ensureSession: () => Promise<IntakeSession | null>;
  onSession: (session: IntakeSession) => void;
  onUseRecorder: () => void;
  onUseText: () => void;
  onReview: () => void;
  /** After the conversation ends (the page refreshes the suggested texts, for example). */
  onEnded?: () => void;
  disabled?: boolean;
}) {
  const [, rerender] = useState(0);
  const [typed, setTyped] = useState("");
  const [supported, setSupported] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  store.onSession = onSession;
  const view = store.view;
  const stream = store.stream;

  useEffect(() => store.subscribe(() => rerender((n) => n + 1)), [store]);
  useEffect(() => {
    setSupported(liveAudioSupported());
    const end = () => void store.stop();
    window.addEventListener("pagehide", end);
    return () => window.removeEventListener("pagehide", end);
  }, [store]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.lines]);

  const active = ACTIVE.includes(view.state);

  function start() {
    store.start(ensureSession);
  }

  async function stop() {
    await store.stop();
    onEnded?.();
  }

  function sendTyped() {
    if (store.sendText(typed)) setTyped("");
  }

  const status = STATUS[view.state];
  const title = view.muted && active ? "Μικρόφωνο σε σίγαση" : status.title;
  const sub = view.muted && active ? "Ο βοηθός δεν σας ακούει. Πατήστε «Ενεργοποίηση μικροφώνου» ή γράψτε παρακάτω." : view.error && (view.state === "error" || view.state === "disconnected") ? view.error : status.sub;

  if (!supported) {
    return (
      <div className="xlive">
        <p className="xalert xalert--warn" role="status"><Icon name="info" size={18} /><span>Αυτός ο browser δεν υποστηρίζει ζωντανή συνομιλία. Χρησιμοποιήστε ηχογράφηση ή πληκτρολόγηση.</span></p>
        <div className="xlive__alt">
          <ActionButton variant="secondary" icon="mic" onClick={onUseRecorder}>Ηχογράφηση και αποστολή</ActionButton>
          <ActionButton variant="ghost" icon="keyboard" onClick={onUseText}>Πληκτρολόγηση</ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="xlive" data-state={view.state} data-active={active || undefined} data-muted={view.muted || undefined}>
      <div className="vorb" data-state={orbState(view.state, view.muted)} data-thinking={["connecting", "thinking", "reconnecting"].includes(view.state) || undefined}>
        <div className="vorb__stage">
          <Waveform stream={stream} active={!view.muted && ["listening", "user_speaking", "waiting"].includes(view.state)} />
          <button
            type="button"
            className="vorb__orb"
            disabled={disabled || view.state === "connecting" || view.state === "reconnecting"}
            aria-label={active ? (view.muted ? "Ενεργοποίηση μικροφώνου" : "Σίγαση μικροφώνου") : view.state === "disconnected" ? "Επανασύνδεση" : "Έναρξη συνομιλίας"}
            aria-pressed={active ? view.muted : undefined}
            onClick={() => (active ? store.setMuted(!view.muted) : view.state === "disconnected" ? void store.retry() : start())}
          >
            <span className="vorb__ring vorb__ring--outer" aria-hidden="true" />
            <span className="vorb__ring vorb__ring--inner" aria-hidden="true" />
            <span className="vorb__core" aria-hidden="true">
              {view.state === "connecting" || view.state === "reconnecting" ? <span className="vorb__spinner" /> : <Icon name={view.muted ? "micOff" : view.state === "speaking" ? "wave" : "mic"} size={34} />}
            </span>
          </button>
        </div>
        <div className="vorb__status" role="status" aria-live="polite">
          <p className="vorb__title"><span className="xlive__dot" aria-hidden="true" />{title}</p>
          <p className="vorb__sub">{sub}</p>
        </div>
      </div>

      {view.state === "idle" && (
        <>
          <ActionButton variant="primary" size="lg" icon="chat" iconAfter="arrowRight" disabled={disabled} onClick={start} className="xlive__start">
            Έναρξη συνομιλίας
          </ActionButton>
          <p className="hint xlive__privacy">
            <Icon name="lock" size={14} /> Ο ήχος στέλνεται σε πραγματικό χρόνο στην υπηρεσία Gemini της Google, μόνο όσο διαρκεί η συνομιλία. Δεν κρατάμε ηχογράφηση· αποθηκεύονται μόνο το κείμενο της συνομιλίας και τα στοιχεία που ελέγχονται. Σε θόρυβο ή με ηχείο, τα ακουστικά βοηθούν.
          </p>
        </>
      )}

      {view.last && view.last.recorded.length > 0 && active && (
        <p className="xlive__recorded" role="status" aria-live="polite">
          <Icon name="check" size={16} /> Καταγράφηκε: {view.last.recorded.map((r) => `${r.label} ${r.value}`).join(" · ")}
        </p>
      )}

      {view.lines.length > 0 && (
        <div className="xlive__log" ref={logRef} role="log" aria-live="polite" aria-label="Η συνομιλία">
          {view.lines.map((l) => (
            <div key={l.id} className={`intake-msg${l.role === "agent" ? " intake-msg--agent" : ""}${l.final ? "" : " xlive__interim"}`}>
              <span className="intake-msg__who">{l.role === "agent" ? "Εσείς" : "Βοηθός"}</span>
              <p>{l.text}{l.interrupted && <span className="hint"> (διακόπηκε)</span>}</p>
            </div>
          ))}
        </div>
      )}

      {active && view.state !== "connecting" && (
        <form className="xlive__type" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
          <label className="sr-only" htmlFor="live-typed">Γράψτε στον βοηθό</label>
          <input id="live-typed" className="input" value={typed} maxLength={1000} placeholder="Ή γράψτε εδώ, π.χ. μια διεύθυνση…" onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <ActionButton type="submit" variant="secondary" size="sm" icon="send" disabled={!typed.trim()}>Αποστολή</ActionButton>
        </form>
      )}

      {view.error && active && <p className="xalert xalert--warn" role="alert"><Icon name="alert" size={18} /><span>{view.error}</span></p>}

      {(view.state === "error" || view.state === "disconnected") && (
        <div className="xlive__alt">
          <ActionButton variant="primary" icon="refresh" onClick={() => (view.state === "disconnected" ? void store.retry() : start())}>{view.state === "disconnected" ? "Επανασύνδεση" : "Δοκιμάστε ξανά"}</ActionButton>
          <ActionButton variant="secondary" icon="mic" onClick={() => { void stop(); onUseRecorder(); }}>Ηχογράφηση και αποστολή</ActionButton>
          <ActionButton variant="ghost" icon="keyboard" onClick={() => { void stop(); onUseText(); }}>Πληκτρολόγηση</ActionButton>
        </div>
      )}

      {(view.reviewSuggested || view.state === "ended") && (
        <div className="xalert xalert--info xlive__review" role="status">
          <span>{view.state === "ended" ? "Τα στοιχεία είναι αποθηκευμένα ως πρόχειρο σε εξέλιξη. Τίποτα δεν δημοσιεύεται." : "Ο βοηθός έχει τα βασικά. Ελέγξτε τη σύνοψη και αποθηκεύστε όταν είστε έτοιμοι."}</span>
          <ActionButton variant="primary" size="sm" iconAfter="arrowRight" onClick={() => { if (active) void stop(); onReview(); }}>Έλεγχος & αποθήκευση</ActionButton>
        </div>
      )}

      {view.state === "ended" && (
        <div className="xlive__alt">
          <ActionButton variant="secondary" icon="chat" onClick={start}>Νέα συνομιλία</ActionButton>
          <ActionButton variant="ghost" icon="keyboard" onClick={onUseText}>Πληκτρολόγηση</ActionButton>
        </div>
      )}

      {active && (
        <div className="xlive__bar" role="group" aria-label="Έλεγχος συνομιλίας">
          <ActionButton variant="secondary" icon={view.muted ? "mic" : "micOff"} aria-pressed={view.muted} onClick={() => store.setMuted(!view.muted)}>
            {view.muted ? "Ενεργοποίηση μικροφώνου" : "Σίγαση"}
          </ActionButton>
          <ActionButton variant="danger" icon="stop" onClick={() => void stop()}>Τερματισμός συνομιλίας</ActionButton>
        </div>
      )}

      {view.state === "idle" && (
        <div className="xlive__alt xlive__alt--quiet">
          <ActionButton variant="ghost" size="sm" icon="mic" onClick={onUseRecorder}>Ηχογράφηση και αποστολή</ActionButton>
          <ActionButton variant="ghost" size="sm" icon="keyboard" onClick={onUseText}>Πληκτρολόγηση</ActionButton>
        </div>
      )}
    </div>
  );
}
