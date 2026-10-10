"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { CapturePanel } from "@/components/intake/CapturePanel";
import { FeatureChips, FieldPicker, FieldRow, ORIGIN_LABEL } from "@/components/intake/fields";
import { LocationPicker } from "@/components/intake/LocationPicker";
import { OfflineDraftEditor } from "@/components/offline/OfflineDraftEditor";
import { SyncStatus } from "@/components/offline/OfflineWorkspace";
import { Stepper, type StepIndex, type StepState } from "@/components/intake/steps";
import { VoiceOrb, type MicState } from "@/components/intake/VoiceOrb";
import { ActionButton, ActionLink, Segmented, Toggle } from "@/components/ui/ActionButton";
import { PendingMedia, type PendingFile } from "@/components/PendingMedia";
import { browserIO, makeLabelPreview, persistOrder, saveAltText } from "@/lib/browser-upload";
import { listenForSpeech, type Listener } from "@/lib/hands-free";
import {
  intakeApi, IntakeRequestError, type IntakeEdit, type IntakeSession, type OwnerCandidate,
} from "@/lib/intake-client";
import { emptyDraft, offlineStore, type OfflineDraft } from "@/lib/offline-store";
import { notifyOffline } from "@/lib/offline-runtime";
import { photoStore } from "@/lib/pending-photos";
import { altUpdates, isLabelCode, PHOTO_LABELS, type PhotoLabel } from "@/lib/photo-labels";
import { uploadAll, type UploadUpdate } from "@/lib/upload-queue";
import { MAX_RECORDING_SECONDS, recordingToWav, toBase64 } from "@/lib/wav";

type Language = "auto" | "el" | "en";

/** Templates for "Δείτε παραδείγματα": the parts in brackets are for the agent to fill, so nothing is sent as if it were a fact. */
const EXAMPLES = [
  { title: "Κατοικία προς πώληση", text: "Πωλείται διαμέρισμα [εμβαδόν] τ.μ. στην περιοχή [περιοχή], στον [όροφο] όροφο, με [αριθμό] υπνοδωμάτια και [αριθμό] μπάνια, στην τιμή των [ποσό] ευρώ." },
  { title: "Επαγγελματικός χώρος προς ενοικίαση", text: "Ενοικιάζεται κατάστημα [εμβαδόν] τ.μ. στην περιοχή [περιοχή], ισόγειο, με μηνιαίο μίσθωμα [ποσό] ευρώ." },
  { title: "Οικόπεδο", text: "Πωλείται οικόπεδο [εμβαδόν] τ.μ. στην περιοχή [περιοχή], εντός σχεδίου, στην τιμή των [ποσό] ευρώ." },
];
const PLACEHOLDER = /\[[^\]]{1,40}\]/;

/**
 * A tiny silent clip, played on the first tap so iOS lets later replies play
 * without another tap. Built as a blob: URL because the CRM's CSP allows blob:
 * media but not data: media.
 */
function silentClipUrl(): string {
  const samples = 800; // 0.1 s at 8 kHz
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const tag = (o: number, t: string) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, 36 + samples, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  tag(36, "data"); view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit PCM silence
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function draftKey(id: string) {
  return `h88.intake.draft.${id}`;
}
function readDraft(id: string): string {
  try {
    return window.localStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(id: string, value: string) {
  try {
    if (value) window.localStorage.setItem(draftKey(id), value);
    else window.localStorage.removeItem(draftKey(id));
  } catch {
    /* private mode or blocked storage: the server already holds the conversation */
  }
}

function labelsKey(id: string) {
  return `h88.intake.labels.${id}`;
}
function readLabels(id: string): Record<string, PhotoLabel> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(labelsKey(id)) ?? "{}") as Record<string, PhotoLabel>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && isLabelCode(v.code)));
  } catch {
    return {};
  }
}
function writeLabels(id: string, labels: Record<string, PhotoLabel>) {
  try {
    if (Object.keys(labels).length) window.localStorage.setItem(labelsKey(id), JSON.stringify(labels));
    else window.localStorage.removeItem(labelsKey(id));
  } catch {
    /* labels are a convenience; the photos themselves are what matter */
  }
}

/** The seconds the agent has to stop a hands-free message before it is sent. */
const AUTO_SEND_SECONDS = 3;
/** After this many silent rounds in a row, hands-free mode switches itself off. */
const MAX_EMPTY_ROUNDS = 3;

export function IntakeAssistant({ maxUploadBytes, resumeId }: { maxUploadBytes: number; resumeId?: string }) {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [available, setAvailable] = useState(true);
  const [resumable, setResumable] = useState<Array<{ id: string; updatedAt: string; fieldCount: number; summary: string | null }>>([]);
  const [session, setSession] = useState<IntakeSession | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mic, setMic] = useState<MicState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [maxChars, setMaxChars] = useState(4000);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [online, setOnline] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [visitedReview, setVisitedReview] = useState(false);
  const [netDown, setNetDown] = useState(false);
  const [offlineDraft, setOfflineDraft] = useState<OfflineDraft | null>(null);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [photos, setPhotos] = useState<PendingFile[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadUpdate> | undefined>();
  const [created, setCreated] = useState<{ id: string; reference: string } | null>(null);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [labels, setLabels] = useState<Record<string, PhotoLabel>>({});
  const [labelling, setLabelling] = useState(false);
  const [restored, setRestored] = useState(0);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerResults, setOwnerResults] = useState<OwnerCandidate[] | null>(null);
  const [ownerOutcome, setOwnerOutcome] = useState<"linked" | "skipped" | "none" | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [autoSend, setAutoSend] = useState<{ text: string; left: number } | null>(null);
  const [photosReady, setPhotosReady] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [pickedKeys, setPickedKeys] = useState<string[]>([]);

  const progressRef = useRef<Record<string, UploadUpdate>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Hands-free mode runs from timers and audio callbacks, which must always see the latest state.
  const handsFreeRef = useRef(false);
  const listenerRef = useRef<Listener | null>(null);
  const heardSpeechRef = useRef(false);
  const discardRef = useRef(false);
  const emptyRounds = useRef(0);
  const autoSendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => undefined);
  const resumeRef = useRef<() => void>(() => undefined);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const examplesRef = useRef<HTMLDialogElement>(null);
  const startingRef = useRef<Promise<IntakeSession | null> | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof IntakeRequestError && e.status === 0) setNetDown(true);
    setError(e instanceof IntakeRequestError ? e.message : "Κάτι πήγε στραβά. Δοκιμάστε ξανά.");
  }, []);
  // Any answer from the server means the connection is back.
  useEffect(() => {
    if (savedAt) setNetDown(false);
  }, [savedAt]);

  // --- Loading and resuming ----------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [status, list] = await Promise.all([intakeApi.status(), intakeApi.list()]);
        if (!alive) return;
        setAvailable(status.available);
        setMaxChars(status.maxUtteranceChars);
        setResumable(list.sessions);
        if (resumeId) {
          const loaded = await intakeApi.get(resumeId);
          if (!alive) return;
          openSession(loaded.session);
        }
        setPhase("ready");
      } catch (e) {
        if (!alive) return;
        fail(e);
        setPhase("ready");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSession(next: IntakeSession, keepInput = false) {
    setSession(next);
    if (!keepInput) setInput(readDraft(next.id));
    setCreated(next.propertyId ? { id: next.propertyId, reference: "" } : null);
    setLabels(readLabels(next.id));
    setSavedAt(new Date());
    void restorePhotos(next);
    // The address names the draft, so a reload (or a phone reopening the tab) lands back in it.
    const url = new URL(window.location.href);
    if (url.searchParams.get("session") !== next.id) {
      url.searchParams.set("session", next.id);
      window.history.replaceState(window.history.state, "", url);
    }
  }

  // The connection state decides what "save" can do and whether the map can load.
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  /** Photos picked before the tab was closed come back from this device's own storage. */
  async function restorePhotos(next: IntakeSession) {
    setPhotosReady(false);
    void photoStore.purgeStale();
    const stored = await photoStore.load(next.id);
    if (stored.length > 0) {
      setPhotos(stored);
      setRestored(stored.length);
    }
    setPhotosReady(true);
  }

  /**
   * The server draft is made on the agent's first action (speaking, sending text, a field), not by a separate
   * "start" click. Concurrent first actions share one request, so there is never a second empty draft.
   */
  async function ensureSession(): Promise<IntakeSession | null> {
    if (session) return session;
    if (startingRef.current) return startingRef.current;
    startingRef.current = (async () => {
      setError(null);
      try {
        const started = (await intakeApi.start("auto")).session;
        openSession(started, true);
        return started;
      } catch (e) {
        fail(e);
        return null;
      } finally {
        startingRef.current = null;
      }
    })();
    return startingRef.current;
  }

  async function resume(id: string) {
    setBusy(true);
    setError(null);
    try {
      openSession((await intakeApi.get(id)).session);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [session?.turns.length]);

  // Unsent text and unsent photos survive an accidental swipe-away or reload warning.
  useEffect(() => {
    if (session) writeDraft(session.id, input);
  }, [input, session]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (photos.length > 0 && !created) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [photos.length, created]);

  // The picked photos are kept on this device until they are uploaded, so closing the tab does not lose them.
  useEffect(() => {
    if (!session || !photosReady || session.status !== "ACTIVE" || created) return;
    const timer = setTimeout(async () => {
      const result = await photoStore.save(session.id, photos);
      setStorageNote(
        result === "saved" ? null : result === "full"
          ? "Ο χώρος του browser γέμισε: οι φωτογραφίες δεν θα σωθούν αν κλείσετε τη σελίδα."
          : "Ο browser δεν επιτρέπει αποθήκευση εδώ: μην κλείσετε τη σελίδα πριν αποθηκεύσετε το πρόχειρο.",
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [photos, photosReady, session, created]);
  useEffect(() => {
    if (session) writeLabels(session.id, labels);
  }, [labels, session]);

  // --- Sound ---------------------------------------------------------------------
  function unlockAudio() {
    if (!audioRef.current) audioRef.current = new Audio();
    const el = audioRef.current;
    if (el.dataset.unlocked) return;
    el.dataset.unlocked = "1";
    el.src = silentClipUrl();
    void el.play().catch(() => undefined);
  }

  /** Speaks the assistant's latest reply. Resolves when it has finished playing (or could not play), so hands-free mode knows when to listen again. */
  async function speak(id: string): Promise<void> {
    setVoiceNote(null);
    try {
      const out = await intakeApi.speak(id);
      if (!out.audio) return;
      const bytes = Uint8Array.from(atob(out.audio), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: out.mimeType ?? "audio/wav" }));
      const el = (audioRef.current ??= new Audio());
      el.src = url;
      const finished = new Promise<void>((resolve) => {
        const end = () => {
          URL.revokeObjectURL(url);
          el.onended = null;
          el.onerror = null;
          resolve();
        };
        el.onended = end;
        el.onerror = end;
        setTimeout(end, 90_000); // never wait forever
      });
      try {
        await el.play();
        setNeedsTap(false);
        await finished;
      } catch {
        setNeedsTap(true); // the browser wants a tap before it plays sound
      }
    } catch {
      setVoiceNote("Η φωνή δεν είναι διαθέσιμη αυτή τη στιγμή· συνεχίζουμε γραπτά.");
    }
  }

  // --- Recording -----------------------------------------------------------------
  /**
   * Starts listening. By default the agent presses the button again to stop. In hands-free mode the
   * recording stops by itself after a pause, a recording is only transcribed if speech was heard, and
   * the microphone is never open while the assistant is speaking.
   */
  function micFailed(message: string) {
    setMicError(message);
    setMic("error");
  }

  async function startRecording(options: { handsFree?: boolean } = {}) {
    unlockAudio();
    setError(null);
    setVoiceNote(null);
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      micFailed("Αυτός ο browser δεν υποστηρίζει ηχογράφηση. Χρησιμοποιήστε την πληκτρολόγηση.");
      if (options.handsFree) stopHandsFree();
      return;
    }
    setMic("requesting_permission");
    const current = await ensureSession();
    if (!current) {
      setMic("idle");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      micFailed(denied ? "Δεν δόθηκε άδεια για το μικρόφωνο. Επιτρέψτε την από το εικονίδιο δίπλα στη διεύθυνση της σελίδας και δοκιμάστε ξανά, ή πληκτρολογήστε." : "Δεν βρέθηκε μικρόφωνο σε αυτή τη συσκευή. Πληκτρολογήστε το μήνυμά σας.");
      if (options.handsFree) stopHandsFree();
      return;
    }
    if (options.handsFree && !handsFreeRef.current) {
      stream.getTracks().forEach((t) => t.stop()); // switched off while the permission prompt was open
      setMic("idle");
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    heardSpeechRef.current = false;
    discardRef.current = false;
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      listenerRef.current?.stop();
      listenerRef.current = null;
      // The microphone is released as soon as the recording ends.
      stream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
      if (recTimer.current) clearInterval(recTimer.current);
      recTimer.current = null;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (discardRef.current || (options.handsFree && !heardSpeechRef.current)) {
        setMic("idle");
        if (options.handsFree && !discardRef.current) noteEmptyRound();
        return;
      }
      emptyRounds.current = 0;
      void transcribeClip(current.id, current.language, new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), options.handsFree === true);
    };
    recorder.start();
    setMicStream(stream);
    setMic("recording");
    setRecSeconds(0);
    if (recTimer.current) clearInterval(recTimer.current);
    recTimer.current = setInterval(() => setRecSeconds((n) => n + 1), 1000);
    stopTimer.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_SECONDS * 1000);
    if (options.handsFree) {
      try {
        listenerRef.current = listenForSpeech(stream, (event) => {
          if (event === "speech_start") heardSpeechRef.current = true;
          else if (recorder.state === "recording") recorder.stop(); // speech_end, too_long, or nobody spoke
        });
      } catch {
        setVoiceNote("Αυτός ο browser δεν υποστηρίζει τη συνομιλία χωρίς χέρια. Χρησιμοποιήστε το κουμπί του μικροφώνου.");
        discardRef.current = true;
        recorder.stop();
        stopHandsFree();
      }
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (r && r.state === "recording") r.stop();
  }

  async function transcribeClip(sessionId: string, language: Language, blob: Blob, auto: boolean) {
    if (blob.size < 1500) {
      if (auto) {
        setMic("idle");
        noteEmptyRound();
      } else micFailed("Η ηχογράφηση ήταν πολύ σύντομη. Πατήστε το μικρόφωνο και μιλήστε.");
      return;
    }
    setMic("processing");
    try {
      const wav = await recordingToWav(blob);
      const out = await intakeApi.transcribe(sessionId, toBase64(wav), "audio/wav", language);
      // The transcript lands in the editable box. By hand nothing is applied until the agent sends it;
      // in hands-free mode it is sent after a short, visible countdown that any tap or edit cancels.
      setInput((cur) => (cur && !auto ? `${cur} ${out.text}` : out.text));
      setMic("transcript_ready");
      if (auto && handsFreeRef.current) beginAutoSend(out.text);
    } catch (e) {
      micFailed(e instanceof IntakeRequestError ? e.message : "Δεν μπόρεσα να διαβάσω την ηχογράφηση. Δοκιμάστε ξανά ή πληκτρολογήστε.");
      if (auto) {
        // A refusal (no key, rate limit) will not fix itself: stop instead of retrying in a loop.
        if (e instanceof IntakeRequestError && e.code !== "no_speech") stopHandsFree();
        else noteEmptyRound();
      }
    }
  }

  // --- Hands-free ------------------------------------------------------------------
  function clearAutoSend() {
    if (autoSendTimer.current) clearInterval(autoSendTimer.current);
    autoSendTimer.current = null;
    setAutoSend(null);
  }

  function beginAutoSend(text: string) {
    clearAutoSend();
    let left = AUTO_SEND_SECONDS;
    setAutoSend({ text, left });
    autoSendTimer.current = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setAutoSend({ text, left });
        return;
      }
      clearAutoSend();
      void sendRef.current(text);
    }, 1000);
  }

  function noteEmptyRound() {
    emptyRounds.current += 1;
    if (emptyRounds.current >= MAX_EMPTY_ROUNDS) {
      setVoiceNote("Δεν άκουσα κάτι για αρκετή ώρα, οπότε έκλεισα τη συνομιλία χωρίς χέρια. Πατήστε ξανά για να συνεχίσετε.");
      stopHandsFree();
      return;
    }
    resumeRef.current();
  }

  async function holdScreenAwake() {
    try {
      const api = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (api && !wakeLock.current) wakeLock.current = await api.request("screen");
    } catch {
      /* the screen may sleep; hands-free pauses with the page */
    }
  }

  function startHandsFree() {
    if (handsFreeRef.current) return;
    handsFreeRef.current = true;
    emptyRounds.current = 0;
    setHandsFree(true);
    void holdScreenAwake();
    void startRecording({ handsFree: true });
  }

  function stopHandsFree() {
    handsFreeRef.current = false;
    setHandsFree(false);
    clearAutoSend();
    if (recorderRef.current?.state === "recording") {
      discardRef.current = true;
      recorderRef.current.stop();
    }
    listenerRef.current?.stop();
    listenerRef.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }

  /** Listen again after a reply has been spoken. */
  function resumeListening() {
    if (!handsFreeRef.current || recorderRef.current?.state === "recording") return;
    void startRecording({ handsFree: true });
  }
  resumeRef.current = resumeListening;

  useEffect(() => {
    if ((session?.status !== "ACTIVE" || created) && handsFreeRef.current) stopHandsFree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, created]);

  // Hands-free stops with the page, with the draft being saved, and on the way out.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && handsFreeRef.current) {
        stopHandsFree();
        setVoiceNote("Η συνομιλία χωρίς χέρια σταμάτησε επειδή φύγατε από τη σελίδα.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopHandsFree();
      if (recTimer.current) clearInterval(recTimer.current);
      if (recorderRef.current?.state === "recording") {
        discardRef.current = true;
        recorderRef.current.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Conversation ---------------------------------------------------------------
  async function send(text = input) {
    if (!text.trim() || busy || PLACEHOLDER.test(text)) return;
    unlockAudio();
    clearAutoSend();
    const current = await ensureSession();
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const out = await intakeApi.turn(current.id, text.trim(), current.revision);
      setSession(out.session);
      setSavedAt(new Date());
      setInput("");
      setMic("idle");
      writeDraft(current.id, "");
      const played = out.session.muted ? Promise.resolve() : speak(out.session.id);
      if (handsFreeRef.current) void played.then(() => resumeRef.current());
    } catch (e) {
      if (handsFreeRef.current) stopHandsFree(); // never keep sending into an error
      if (e instanceof IntakeRequestError && e.status === 409) {
        const fresh = await intakeApi.get(current.id).catch(() => null);
        if (fresh) setSession(fresh.session);
      }
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  sendRef.current = send;

  async function edit(change: IntakeEdit) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession((await intakeApi.edit(session.id, change, session.revision)).session);
      setSavedAt(new Date());
      return true;
    } catch (e) {
      if (e instanceof IntakeRequestError && e.status === 409) {
        const fresh = await intakeApi.get(session.id).catch(() => null);
        if (fresh) setSession(fresh.session);
      }
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Without a connection the draft continues on this device: the server values become the baseline (so a
   * change made elsewhere meanwhile is caught as a conflict, not overwritten), the unsent text is kept as
   * notes for the assistant, and the photos already kept for this draft stay where they are.
   */
  async function draftOnDevice(createWhenSynced: boolean): Promise<OfflineDraft | null> {
    if (!session) return null;
    const values = Object.fromEntries(Object.entries(session.fields).map(([k, f]) => [k, f.value]));
    const location = session.location ? { lat: session.location.lat, lng: session.location.lng, accuracy: session.location.accuracy, source: session.location.source, visibility: session.location.visibility } : null;
    try {
      await photoStore.save(session.id, photos);
      const existing = (await offlineStore.list()).drafts.find((d) => d.sessionId === session.id);
      const base: OfflineDraft = existing ?? { ...emptyDraft(), sessionId: session.id, base: values, fields: values, baseLocation: location, location };
      const saved = await offlineStore.save({ ...base, notes: input.trim() ? input : base.notes, createWhenSynced: createWhenSynced || base.createWhenSynced }, photos.length > 0);
      notifyOffline();
      return saved;
    } catch {
      setError("Ο browser δεν επιτρέπει αποθήκευση σε αυτή τη συσκευή. Μην κλείσετε τη σελίδα μέχρι να επανέλθει η σύνδεση.");
      return null;
    }
  }

  async function continueOffline() {
    const d = await draftOnDevice(false);
    if (d) setOfflineDraft(d);
  }

  async function saveOnDevice() {
    const d = await draftOnDevice(true);
    if (!d) return;
    const { ops } = await offlineStore.get(d.localId);
    const waiting = ops.filter((o) => o.status !== "done").length;
    setDeviceNote(`Αποθηκεύτηκε στη συσκευή · ${waiting} ${waiting === 1 ? "ενέργεια εκκρεμεί" : "ενέργειες εκκρεμούν"}. Θα αποθηκευτεί ως πρόχειρο ακίνητο μόλις επανέλθει η σύνδεση.`);
  }

  /** A settings change on a session that may have been created a moment ago (its state is not yet in React). */
  async function editOn(target: IntakeSession, change: IntakeEdit) {
    setBusy(true);
    setError(null);
    try {
      setSession((await intakeApi.edit(target.id, change, target.revision)).session);
      setSavedAt(new Date());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession((await intakeApi.suggest(session.id)).session);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveEditing() {
    if (!editing) return;
    const spec = session?.catalog.find((c) => c.key === editing.key);
    if (!spec) return;
    const raw = editing.value.trim();
    if (!raw) {
      if (await edit({ type: "clear", key: editing.key })) setEditing(null);
      return;
    }
    const value = spec.kind === "bool" ? raw === "true" : spec.kind === "int" || spec.kind === "decimal" ? raw.replace(",", ".") : raw;
    if (await edit({ type: "set", key: editing.key, value: spec.kind === "int" || spec.kind === "decimal" ? Number(value) : value })) setEditing(null);
  }

  // --- Saving the draft and uploading photos ---------------------------------------
  async function runUploads(propertyId: string, list: PendingFile[]) {
    const io = browserIO(propertyId);
    const sessionId = session?.id;
    const result = await uploadAll(io, list.map((p) => p.file), "PHOTO", (index, update) => {
      const item = list[index];
      if (item) {
        progressRef.current = { ...progressRef.current, [item.id]: update };
        setProgress(progressRef.current);
        // Once a photo is safely uploaded it no longer needs the copy kept on this device.
        if (update.state === "done" && sessionId) void photoStore.remove(sessionId, item.id);
      }
    });
    await applyLabels(propertyId, list);
    return result;
  }

  /** Accepted room labels become the photos' alternative text; a failure here never undoes an upload. */
  async function applyLabels(propertyId: string, list: PendingFile[]) {
    const updates = altUpdates(list, labels, (photoId) => (progressRef.current[photoId]?.state === "done" ? progressRef.current[photoId]?.mediaId : undefined));
    if (updates.length === 0) return;
    const failed = await saveAltText(propertyId, updates);
    if (failed > 0) setVoiceNote(`Οι ετικέτες ${failed} φωτογραφιών δεν αποθηκεύτηκαν· μπορείτε να τις προσθέσετε από το ακίνητο.`);
  }

  /** The agent's order becomes the gallery order, and the first photo the cover (as on the normal form). */
  async function savePhotoOrder(propertyId: string, list: PendingFile[]) {
    const ids = list.map((p) => progressRef.current[p.id]?.mediaId).filter((m): m is string => Boolean(m));
    if (ids.length === list.length) await persistOrder(propertyId, ids).catch((e) => console.error("Saving the photo order failed", e));
  }

  async function saveDraft() {
    if (!session || busy) return;
    if (handsFreeRef.current) stopHandsFree();
    setBusy(true);
    setError(null);
    try {
      const out = await intakeApi.create(session.id, session.revision);
      setSession(out.session);
      setCreated(out.property);
      setOwnerOutcome(out.owner);
      setSavedAt(new Date());
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2500);
      setStep(4); // the result (reference, uploads, owner) is shown on the last step, whichever step saved it
      if (photos.length > 0) {
        const result = await runUploads(out.property.id, photos);
        if (result.failed === 0) await savePhotoOrder(out.property.id, photos);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** Photos left over from a closed tab, for a draft that was already saved: upload them now. */
  async function uploadRestored() {
    if (!created || photos.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      progressRef.current = {};
      const result = await runUploads(created.id, photos);
      if (result.failed === 0) setRestored(0);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // --- Room labels for photos ------------------------------------------------------
  async function suggestLabels() {
    if (!session || photos.length === 0) return;
    const todo = photos.filter((p) => !labels[p.id]);
    if (todo.length === 0) return;
    setLabelling(true);
    setError(null);
    try {
      for (let i = 0; i < todo.length; i += 12) {
        const batch = todo.slice(i, i + 12);
        const previews = (await Promise.all(batch.map(async (p) => ({ id: p.id, preview: await makeLabelPreview(p.file) })))).flatMap((p) => (p.preview ? [{ id: p.id, ...p.preview }] : []));
        if (previews.length === 0) continue;
        const out = await intakeApi.labelPhotos(session.id, previews);
        setLabels((cur) => {
          const next = { ...cur };
          for (const l of out.labels) if (isLabelCode(l.label)) next[l.id] = { code: l.label, confidence: l.confidence, accepted: false };
          return next;
        });
      }
    } catch (e) {
      fail(e);
    } finally {
      setLabelling(false);
    }
  }

  const photoLabel = (id: string) => labels[id];
  function chooseLabel(id: string, code: string) {
    setLabels((cur) => {
      const next = { ...cur };
      if (!isLabelCode(code)) delete next[id];
      else next[id] = { code, confidence: "agent", accepted: true };
      return next;
    });
  }
  const acceptLabel = (id: string) => setLabels((cur) => (cur[id] ? { ...cur, [id]: { ...cur[id]!, accepted: true } } : cur));
  const acceptAllLabels = () => setLabels((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, { ...v, accepted: true }])));

  // --- Owner -----------------------------------------------------------------------
  async function searchOwner() {
    const q = ownerQuery.trim();
    if (q.length < 2) {
      setOwnerResults(null);
      return;
    }
    try {
      setOwnerResults((await intakeApi.searchContacts(q)).contacts);
    } catch (e) {
      fail(e);
    }
  }

  async function chooseOwner(contactId: string | null) {
    if (await edit({ type: "owner", contactId })) {
      setOwnerResults(null);
      setOwnerQuery("");
    }
  }

  async function retryPhotos() {
    if (!created) return;
    const failed = photos.filter((p) => progress?.[p.id]?.state === "failed");
    if (failed.length === 0) return;
    setBusy(true);
    try {
      const result = await runUploads(created.id, failed);
      if (result.failed === 0) await savePhotoOrder(created.id, photos);
    } finally {
      setBusy(false);
    }
  }

  // --- Render ---------------------------------------------------------------------
  if (phase === "loading") return <p className="muted" role="status">Φόρτωση…</p>;

  const done = session?.status === "CREATED" || Boolean(created);
  const locked = busy || done;
  const micBusy = mic === "recording" || mic === "processing" || mic === "requesting_permission";
  const hasPlaceholder = PLACEHOLDER.test(input);
  const lastAgent = session ? [...session.turns].reverse().find((t) => t.role === "agent") : undefined;
  const lastAssistant = session ? [...session.turns].reverse().find((t) => t.role === "assistant") : undefined;

  function insertText(text: string) {
    setMode("type");
    setInput((cur) => (cur.trim() ? `${cur.trimEnd()} ${text}` : text));
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  const pressOrb = () => {
    if (mic === "recording") return stopRecording();
    if (handsFree) return;
    void startRecording();
  };

  async function goStep(i: StepIndex) {
    if (i > 0 && !session && !(await ensureSession())) return;
    if (i === 4) setVisitedReview(true);
    setStep(i);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const voiceCard = (
    <section className="xcard xvoice" aria-labelledby="voice-title">
      <header className="xvoice__head">
        <span className="xicon-tile" aria-hidden="true"><Icon name="mic" size={24} /></span>
        <div>
          <h2 id="voice-title">Φωνητική καταχώριση</h2>
          <p>Μιλήστε ή πληκτρολογήστε τις πληροφορίες του ακινήτου σας.</p>
        </div>
      </header>

      <div className="xvoice__controls">
        <Segmented<Language>
          label="Γλώσσα αναγνώρισης και απαντήσεων"
          value={session?.language ?? "auto"}
          disabled={locked || micBusy}
          onChange={async (l) => {
            const current = await ensureSession();
            if (current) await editOn(current, { type: "settings", language: l });
          }}
          options={[
            { value: "auto", label: "Αυτόματα", icon: "sparkle", title: "Ο βοηθός αναγνωρίζει μόνος του ελληνικά ή αγγλικά" },
            { value: "el", label: "Ελληνικά", icon: "lines", title: "Η αναγνώριση ομιλίας και οι απαντήσεις στα ελληνικά" },
            { value: "en", label: "English", icon: "globe", title: "Speech recognition and replies in English" },
          ]}
        />
        <Toggle
          on={!(session?.muted ?? false)}
          icon="wave"
          label={<>Φωνή: <strong>{session?.muted ? "Όχι" : "Ναι"}</strong></>}
          title="Ο βοηθός διαβάζει δυνατά τις απαντήσεις του"
          disabled={locked}
          onChange={async (on) => {
            const current = await ensureSession();
            if (current) await editOn(current, { type: "settings", muted: !on });
          }}
        />
        <Toggle
          on={handsFree}
          icon="hand"
          label={handsFree ? "Χωρίς χέρια: ενεργό" : "Χωρίς χέρια"}
          title="Μιλάτε χωρίς να πατάτε κουμπί: ο βοηθός ακούει, απαντά και ξανακούει. Πριν από κάθε αποστολή έχετε 3 δευτερόλεπτα να την ακυρώσετε."
          disabled={done || !available || (busy && !handsFree)}
          onChange={(on) => (on ? startHandsFree() : stopHandsFree())}
        />
      </div>

      {!available && (
        <p className="xalert" role="status">
          <Icon name="info" size={18} />
          <span>Η φωνή και η αυτόματη συμπλήρωση δεν είναι ρυθμισμένες στον server (λείπει το κλειδί Gemini). Συμπληρώστε τα στοιχεία στο βήμα «Βασικά στοιχεία» ή χρησιμοποιήστε την <Link href="/properties/new">κανονική φόρμα</Link>.</span>
        </p>
      )}

      {mode === "voice" && (
        <VoiceOrb
          state={mic}
          stream={micStream}
          seconds={recSeconds}
          maxSeconds={MAX_RECORDING_SECONDS}
          thinking={busy && !done}
          handsFree={handsFree}
          disabled={done || !available || busy || (handsFree && mic !== "recording")}
          errorText={micError}
          onPress={pressOrb}
        />
      )}

      {mic === "error" && mode === "voice" && (
        <div className="xvoice__retry">
          <ActionButton variant="secondary" size="sm" icon="mic" onClick={() => void startRecording()} disabled={!available || busy}>Δοκιμάστε ξανά</ActionButton>
          <ActionButton variant="ghost" size="sm" icon="keyboard" onClick={() => { setMic("idle"); setMode("type"); }}>Πληκτρολόγηση</ActionButton>
        </div>
      )}

      {handsFree && autoSend && (
        <div className="xalert xalert--info xhandsfree" role="status" aria-live="polite">
          <span>Αποστολή σε <strong>{autoSend.left}</strong>…</span>
          <span className="xhandsfree__buttons">
            <ActionButton variant="secondary" size="sm" onClick={() => { clearAutoSend(); stopRecording(); }}>Ακύρωση — θα το διορθώσω</ActionButton>
            <ActionButton variant="primary" size="sm" onClick={() => void send(autoSend.text)}>Στείλε τώρα</ActionButton>
          </span>
        </div>
      )}
      {handsFree && !autoSend && mic === "transcript_ready" && !busy && (
        <div className="xalert xalert--info xhandsfree" role="status">
          <span>Διορθώστε το κείμενο και πατήστε «Αποστολή στον βοηθό»· μετά την απάντηση θα ακούω ξανά.</span>
          <ActionButton variant="secondary" size="sm" icon="mic" onClick={() => { setInput(""); setMic("idle"); resumeListening(); }}>Άκου ξανά από την αρχή</ActionButton>
        </div>
      )}
      {handsFree && !autoSend && mic === "idle" && !busy && (
        <div className="xalert xalert--info xhandsfree" role="status">
          <span>Συνομιλία χωρίς χέρια ενεργή. Θα ακούσω ξανά μόλις απαντήσω.</span>
          <ActionButton variant="secondary" size="sm" icon="mic" onClick={() => resumeListening()}>Άκου τώρα</ActionButton>
        </div>
      )}

      {(mode === "type" || input.trim() || mic === "transcript_ready") && !done && (
        <div className="xcomposer">
          <label htmlFor="intake-text">{mic === "transcript_ready" && mode === "voice" ? "Απομαγνητοφώνηση — ελέγξτε και διορθώστε πριν τη στείλετε" : "Περιγραφή ακινήτου"}</label>
          <textarea
            id="intake-text"
            ref={textRef}
            rows={5}
            maxLength={maxChars}
            value={input}
            placeholder="Π.χ. Διαμέρισμα 95 τ.μ. στη Γλυφάδα, 3ος όροφος, 2 υπνοδωμάτια, τιμή 350.000 ευρώ."
            disabled={busy || mic === "processing"}
            onChange={(e) => { if (autoSend) clearAutoSend(); setInput(e.target.value); if (!e.target.value.trim() && mic === "transcript_ready") setMic("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
          />
          {hasPlaceholder && <p className="xfield-note" role="status"><Icon name="alert" size={15} /> Συμπληρώστε τα σημεία σε αγκύλες [ ] με τα πραγματικά στοιχεία πριν την αποστολή.</p>}
          <div className="xcomposer__foot">
            <span className="hint">{input.length.toLocaleString("el-GR")} / {maxChars.toLocaleString("el-GR")} χαρακτήρες · Ctrl+Enter για αποστολή</span>
            <span className="xcomposer__buttons">
              {input.trim() && <ActionButton variant="ghost" size="sm" disabled={busy} onClick={() => { setInput(""); if (mic === "transcript_ready") setMic("idle"); }}>Καθαρισμός</ActionButton>}
              {mode === "type" && <ActionButton variant="secondary" size="sm" icon="mic" disabled={!available} onClick={() => setMode("voice")}>Φωνή</ActionButton>}
              {mode === "voice" && mic === "transcript_ready" && !handsFree && <ActionButton variant="secondary" size="sm" icon="mic" disabled={busy || !available} onClick={() => void startRecording()}>Συνέχεια με φωνή</ActionButton>}
              <ActionButton variant="primary" size="sm" iconAfter="arrowRight" loading={busy} loadingLabel="Επεξεργασία…" disabled={!input.trim() || !available || hasPlaceholder || mic === "processing"} onClick={() => void send()}>
                Αποστολή στον βοηθό
              </ActionButton>
            </span>
          </div>
        </div>
      )}

      {mode === "voice" && !done && (
        <div className="xvoice__actions">
          <ActionButton variant="secondary" size="lg" icon="keyboard" disabled={micBusy} onClick={() => { setMode("type"); requestAnimationFrame(() => textRef.current?.focus()); }}>
            Πληκτρολόγηση
          </ActionButton>
          {mic === "recording" ? (
            <ActionButton variant="danger" size="lg" icon="stop" onClick={stopRecording}>Τέλος ηχογράφησης</ActionButton>
          ) : (
            <ActionButton
              variant="primary"
              size="lg"
              icon="sparkle"
              iconAfter="arrowRight"
              loading={mic === "requesting_permission" || mic === "processing"}
              loadingLabel={mic === "processing" ? "Επεξεργασία…" : "Αναμονή άδειας…"}
              disabled={!available || busy || handsFree}
              onClick={() => void startRecording()}
            >
              {session?.turns.some((t) => t.role === "agent") ? "Συνέχεια με φωνή" : "Έναρξη φωνητικής καταχώρισης"}
            </ActionButton>
          )}
        </div>
      )}
      {mode === "type" && !done && !input.trim() && (
        <p className="hint xvoice__typing-hint">Γράψτε ελεύθερα, σε ελληνικά ή αγγλικά. Ο βοηθός συμπληρώνει τα πεδία από όσα γράφετε και ρωτά ό,τι λείπει.</p>
      )}

      {voiceNote && <p className="xalert" role="status"><Icon name="info" size={18} /><span>{voiceNote}</span></p>}

      {session?.pending.map((p) => (
        <div key={p.key} className="xalert xalert--warn xconfirm" role="group" aria-label={`Επιβεβαίωση: ${p.label}`}>
          <span>
            {p.reason === "conflict" && p.current ? <>{p.label}: <s>{p.current}</s> → <strong>{p.proposed}</strong>;</> : <>{p.label}: <strong>{p.proposed}</strong>. Είναι σωστό;</>}
          </span>
          <span className="xconfirm__buttons">
            <ActionButton variant="primary" size="sm" icon="check" disabled={busy} onClick={() => void edit({ type: "resolve", key: p.key, accept: true })}>Ναι</ActionButton>
            <ActionButton variant="secondary" size="sm" disabled={busy} onClick={() => void edit({ type: "resolve", key: p.key, accept: false })}>Όχι</ActionButton>
          </span>
        </div>
      ))}

      {session && session.turns.length > 0 && (
        <div className="xconvo" aria-live="polite">
          {showLog ? (
            <div className="intake-log" ref={logRef} aria-label="Όλη η συνομιλία">
              {session.turns.map((t, i) => (
                <div key={`${t.at}-${i}`} className={t.role === "agent" ? "intake-msg intake-msg--agent" : "intake-msg"}>
                  <span className="intake-msg__who">{t.role === "agent" ? "Εσείς" : "Βοηθός"}</span>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
              {lastAgent && (
                <div className="intake-msg intake-msg--agent">
                  <span className="intake-msg__who">Εσείς</span>
                  <p>{lastAgent.text}</p>
                </div>
              )}
              {lastAssistant && (
                <div className="intake-msg xreply">
                  <span className="intake-msg__who">Βοηθός</span>
                  <p>{lastAssistant.text}</p>
                </div>
              )}
            </>
          )}
          {busy && !done && <div className="intake-msg intake-msg--thinking" role="status">Ο βοηθός ενημερώνει την καταχώριση…</div>}
          <div className="xconvo__tools">
            {lastAssistant && !session.muted && (
              <>
                <ActionButton variant={needsTap ? "primary" : "ghost"} size="sm" icon="play" onClick={() => { unlockAudio(); void speak(session.id); }}>Ακούστε</ActionButton>
                <ActionButton variant="ghost" size="sm" icon="stop" onClick={() => audioRef.current?.pause()}>Διακοπή</ActionButton>
              </>
            )}
            {session.asked && !done && <ActionButton variant="ghost" size="sm" disabled={busy} onClick={() => void edit({ type: "skip", key: session.asked!.key })}>Παράλειψη: {session.asked.label}</ActionButton>}
            {!done && <ActionButton variant="ghost" size="sm" icon="undo" disabled={busy || !session.canUndo} onClick={() => void edit({ type: "undo" })} title={session.canUndo ? "Επαναφέρει την τελευταία αλλαγή σε στοιχείο" : "Δεν υπάρχει αλλαγή για αναίρεση"}>Αναίρεση τελευταίας αλλαγής</ActionButton>}
            {session.turns.length > 2 && <ActionButton variant="ghost" size="sm" icon="chat" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>{showLog ? "Μόνο τα τελευταία" : `Όλη η συνομιλία (${session.turns.length})`}</ActionButton>}
          </div>
        </div>
      )}
    </section>
  );

  const helpCard = (
    <section className="xcard xhelp" aria-label="Χρήσιμη συμβουλή">
      <span className="xicon-tile xicon-tile--sm" aria-hidden="true"><Icon name="bulb" size={20} /></span>
      <div>
        <h3>Χρήσιμη συμβουλή</h3>
        <p>Πείτε τύπο, περιοχή, τιμή, εμβαδόν και ό,τι ξεχωρίζει (όροφος, υπνοδωμάτια, θέα). Τηλέφωνα και email ιδιοκτητών μην τα λέτε: ο ιδιοκτήτης επιλέγεται στα «Βασικά στοιχεία».</p>
      </div>
      <ActionButton variant="ghost" size="sm" iconAfter="arrowRight" onClick={() => examplesRef.current?.showModal()}>Δείτε παραδείγματα</ActionButton>
    </section>
  );

  const examplesDialog = (
    <dialog ref={examplesRef} className="xdialog" aria-labelledby="examples-title" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="xdialog__body">
        <h2 id="examples-title">Παραδείγματα περιγραφής</h2>
        <p className="hint">Πατήστε «Χρήση» για να μπει το πρότυπο στο κείμενο. Συμπληρώστε τα σημεία σε αγκύλες με τα πραγματικά στοιχεία πριν το στείλετε.</p>
        <ul className="xexamples">
          {EXAMPLES.map((ex) => (
            <li key={ex.title}>
              <strong>{ex.title}</strong>
              <p>{ex.text}</p>
              <ActionButton variant="secondary" size="sm" icon="keyboard" onClick={() => { examplesRef.current?.close(); insertText(ex.text); }}>Χρήση</ActionButton>
            </li>
          ))}
        </ul>
        <div className="xdialog__foot"><ActionButton variant="primary" size="sm" onClick={() => examplesRef.current?.close()}>Κλείσιμο</ActionButton></div>
      </div>
    </dialog>
  );

  // Before the first action there is no server draft yet: the first screen still works, and drafts left half-done can be continued.
  const drafts = resumable.filter((r) => r.fieldCount > 0);
  if (!session) {
    return (
      <div className="xintake">
        {error && <p className="xalert xalert--danger" role="alert"><Icon name="alert" size={18} /><span>{error}</span></p>}
        {drafts.length > 0 && (
          <div className="xresume">
            <span className="xresume__lead"><Icon name="clock" size={18} /> {drafts.length === 1 ? "Έχετε μια καταχώριση σε εξέλιξη" : `Έχετε ${drafts.length} καταχωρίσεις σε εξέλιξη`}</span>
            <span className="xresume__latest">
              <span>{drafts[0]!.summary ?? "Χωρίς περιγραφή"} <span className="hint">· {drafts[0]!.fieldCount} στοιχεία</span></span>
              <ActionButton variant="secondary" size="sm" iconAfter="arrowRight" disabled={busy} onClick={() => void resume(drafts[0]!.id)}>Συνέχεια</ActionButton>
            </span>
            {drafts.length > 1 && (
              <details className="xresume__all">
                <summary>Όλες ({drafts.length})</summary>
                <ul>
                  {drafts.slice(1, 8).map((r) => (
                    <li key={r.id}>
                      <span>{r.summary ?? "Χωρίς περιγραφή"} <span className="hint">· {r.fieldCount} στοιχεία · {new Date(r.updatedAt).toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" })}</span></span>
                      <ActionButton variant="ghost" size="sm" disabled={busy} onClick={() => void resume(r.id)}>Συνέχεια</ActionButton>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <Stepper current={0} states={["todo", "todo", "todo", "todo", "todo"]} onGo={(i) => void goStep(i)} />
        <div className="xgrid">
          <div className="xmain">
            {voiceCard}
            {helpCard}
          </div>
          <CapturePanel session={null} onGo={(i) => void goStep(i)} onShortcut={insertText} disabled={busy} />
        </div>
        <div className="xbar" role="group" aria-label="Αποθήκευση και πλοήγηση">
          <p className="xbar__status"><Icon name="info" size={16} /> Η καταχώριση αποθηκεύεται αυτόματα από την πρώτη σας κίνηση.</p>
          <span className="xbar__actions">
            <ActionButton variant="primary" iconAfter="arrowRight" disabled={busy} onClick={() => void goStep(1)}>Συνέχεια</ActionButton>
          </span>
        </div>
        {examplesDialog}
      </div>
    );
  }

  if (offlineDraft) {
    return (
      <div className="xintake">
        <OfflineDraftEditor
          initial={offlineDraft}
          online={online && !netDown}
          onDone={async () => {
            setOfflineDraft(null);
            // Back with a connection: show what the server holds now.
            const fresh = await intakeApi.get(session.id).catch(() => null);
            if (fresh) {
              setSession(fresh.session);
              setSavedAt(new Date());
            }
          }}
        />
      </div>
    );
  }

  const offlineNow = !online || netDown;
  const specOf = (key: string) => session.catalog.find((c) => c.key === key);
  const specsOf = (keys: readonly string[]) => keys.flatMap((k) => (specOf(k) ? [specOf(k)!] : []));
  const photoFailures = photos.filter((p) => progress?.[p.id]?.state === "failed").length;

  // What goes where. Step 2 holds what every listing needs; step 3 what this TYPE of property has.
  const TEXT_KEYS = ["titleEl", "titleEn", "descriptionEl", "descriptionEn"];
  const GROUPS = {
    type: ["listingType", "propertyType"],
    price: ["price", "priceOnRequest", "monthlyRent", "deposit", "minRentalMonths"],
    location: ["areaName", "city", "region", "neighborhood", "address", "postalCode"],
    size: ["area", "plotArea", "builtArea", "condition"],
  };
  const basicKeys = new Set(Object.values(GROUPS).flat());
  const layout = session.layout;
  const isBool = (k: string) => specOf(k)?.kind === "bool";
  const mainKeys = layout ? [...new Set([...layout.recommended, ...layout.core])].filter((k) => !basicKeys.has(k) && !isBool(k) && !TEXT_KEYS.includes(k)) : [];
  const featureKeys = layout ? layout.features.filter((k) => isBool(k)) : [];
  const shownKeys = new Set([...basicKeys, ...mainKeys, ...featureKeys, ...TEXT_KEYS]);
  const extraShown = session.catalog.filter((c) => !shownKeys.has(c.key) && (session.fields[c.key] || pickedKeys.includes(c.key)));
  const pickable = session.catalog.filter((c) => !shownKeys.has(c.key) && !session.fields[c.key] && !pickedKeys.includes(c.key));

  const filled = (keys: string[]) => keys.some((k) => session.fields[k]);
  const unconfirmed = (keys: Iterable<string>) => [...keys].some((k) => session.fields[k] && !session.fields[k]!.confirmed);
  const stepStates: StepState[] = [
    session.pending.length > 0 ? "warn" : session.turns.some((t) => t.role === "agent") || Object.keys(session.fields).length > 0 ? "done" : "todo",
    unconfirmed(basicKeys) ? "warn" : Boolean(session.fields.listingType && session.fields.propertyType) && filled(GROUPS.price) && filled(GROUPS.location) && filled(GROUPS.size) ? "done" : "todo",
    unconfirmed([...mainKeys, ...featureKeys]) ? "warn" : filled([...mainKeys, ...featureKeys]) ? "done" : "todo",
    photos.length > 0 || session.photosLater ? "done" : "todo",
    done ? "done" : visitedReview && session.review.blockers.length > 0 ? "warn" : "todo",
  ];
  const go = (i: StepIndex) => void goStep(i);

  const setField = async (key: string, value: string | number | boolean | null) =>
    (await edit(value === null ? { type: "clear", key } : { type: "set", key, value })) ?? false;
  const confirm = (key: string) => void edit({ type: "confirm", key });
  const rows = (keys: readonly string[]) =>
    specsOf(keys).map((spec) => <FieldRow key={spec.key} spec={spec} session={session} disabled={locked} onSet={setField} onConfirm={confirm} />);

  // "Συνέχεια" goes on only when the next step has what it needs; the step bar stays free for going back and forth.
  const nextBlocked = step === 1 && !layout ? "Δηλώστε είδος αγγελίας και τύπο ακινήτου: τα χαρακτηριστικά εξαρτώνται από αυτόν." : null;
  const saveBlocked = done ? null : !session.review.ready ? (session.review.blockers[0] ?? "Δηλώστε είδος αγγελίας και τύπο ακινήτου.") : null;
  const savedLabel = savedAt ? savedAt.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" }) : null;

  const locationCard = (
    <section className="xcard ipanel" aria-label="Θέση στον χάρτη">
      <h3>Θέση στον χάρτη</h3>
      <p className="hint">Για το γραφείο κρατιέται το ακριβές σημείο· εσείς επιλέγετε τι θα δείχνει ο ιστότοπος.</p>
      <LocationPicker
        value={session.location ? { lat: session.location.lat, lng: session.location.lng, accuracy: session.location.accuracy, source: session.location.source, visibility: session.location.visibility } : null}
        disabled={locked}
        online={online}
        onChange={(loc) => void edit(loc ? { type: "location", ...loc } : { type: "location", clear: true })}
      />
    </section>
  );

  const ownerCard = (
    <section className="xcard ipanel" aria-label="Ιδιοκτήτης">
      <h3>Ιδιοκτήτης</h3>
      <p className="hint">Επιλέξτε μια υπάρχουσα επαφή. Μην υπαγορεύετε τηλέφωνα ή email στον βοηθό· ψάξτε την επαφή εδώ ή δημιουργήστε πρώτα τη νέα επαφή.</p>
      {session.owner ? (
        <p>
          <strong>{session.owner.label}</strong> <span className="hint">· {session.owner.reference}</span>
          {!done && <> <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void chooseOwner(null)}>Αφαίρεση</button></>}
        </p>
      ) : (
        <p className="muted">Δεν έχει οριστεί ιδιοκτήτης.</p>
      )}
      {!done && (
        <>
          <div className="intake-edit">
            <label className="sr-only" htmlFor="owner-q">Αναζήτηση επαφής</label>
            <input id="owner-q" type="search" value={ownerQuery} placeholder="Όνομα, εταιρεία, κωδικός, τηλέφωνο ή email" onChange={(e) => setOwnerQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchOwner(); }} />
            <button type="button" className="btn btn--outline btn--sm" disabled={busy || ownerQuery.trim().length < 2} onClick={() => void searchOwner()}>Αναζήτηση</button>
            <Link className="btn btn--ghost btn--sm" href="/contacts/new" target="_blank" rel="noopener">Νέα επαφή ↗</Link>
          </div>
          {ownerResults && ownerResults.length === 0 && <p className="hint">Δεν βρέθηκε επαφή. Δημιουργήστε την από το «Νέα επαφή» και αναζητήστε ξανά.</p>}
          {ownerResults && ownerResults.length > 0 && (
            <ul className="intake-rows">
              {ownerResults.map((c) => (
                <li key={c.id}>
                  <div className="intake-rows__main"><strong>{c.name}</strong><span className="hint">{[c.reference, c.city, c.phoneHint].filter(Boolean).join(" · ")}</span></div>
                  <div className="intake-rows__meta"><button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void chooseOwner(c.id)}>Επιλογή</button></div>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Ο ιδιοκτήτης συνδέεται όταν αποθηκευτεί το πρόχειρο.</p>
        </>
      )}
    </section>
  );

  const photoSection = (
    <section className="xcard ipanel" aria-label="Φωτογραφίες">
      <h2>Φωτογραφίες</h2>
      <p className="hint">Φωτογραφίστε τώρα ή προσθέστε τις αργότερα. Παραμένουν ιδιωτικές μέχρι να εγκριθούν και κρατιούνται σε αυτή τη συσκευή μέχρι να ανέβουν.</p>
      {storageNote && <p className="notice" role="status">{storageNote}</p>}
      {restored > 0 && !done && <p className="notice" role="status">Επαναφέρθηκαν {restored} φωτογραφίες που είχατε επιλέξει πριν κλείσει η σελίδα.</p>}
      {restored > 0 && done && !progress && (
        <div className="notice notice--danger" role="alert">
          Το πρόχειρο είχε αποθηκευτεί, αλλά {photos.length} φωτογραφίες δεν είχαν ανέβει πριν κλείσει η σελίδα.
          <div style={{ marginTop: 8 }}><button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void uploadRestored()}>Ανέβασμα τώρα</button></div>
        </div>
      )}
      <PendingMedia
        files={photos}
        onChange={setPhotos}
        progress={progress}
        disabled={busy || (done && !(restored > 0 && !progress))}
        maxBytes={maxUploadBytes}
        camera
        renderExtra={(item) => {
          const label = photoLabel(item.id);
          if (!label && !(photos.length > 0 && !progress)) return null;
          return (
            <span className="intake-photo-label">
              <label className="sr-only" htmlFor={`label-${item.id}`}>Ετικέτα φωτογραφίας {item.file.name}</label>
              <select id={`label-${item.id}`} value={label?.code ?? ""} disabled={busy || Boolean(progress)} onChange={(e) => chooseLabel(item.id, e.target.value)}>
                <option value="">Χωρίς ετικέτα</option>
                {PHOTO_LABELS.map((l) => <option key={l.code} value={l.code}>{l.el}</option>)}
              </select>
              {label && !label.accepted && (
                <>
                  <span className="badge badge--warn">Πρόταση AI{label.confidence === "low" ? " (αβέβαιη)" : ""} — επιβεβαιώστε</span>
                  <button type="button" className="btn btn--outline btn--sm" disabled={busy || Boolean(progress)} onClick={() => acceptLabel(item.id)}>Αποδοχή</button>
                </>
              )}
              {label?.accepted && <span className="badge badge--ok">Ετικέτα</span>}
            </span>
          );
        }}
      />
      {!done && photos.length > 0 && !progress && (
        <div className="intake-label-actions">
          <button type="button" className="btn btn--outline btn--sm" disabled={busy || labelling || !available || photos.every((p) => labels[p.id])} onClick={() => void suggestLabels()}>
            {labelling ? "Ανάλυση…" : "Πρόταση ετικετών από AI"}
          </button>
          {Object.values(labels).some((l) => !l.accepted) && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={acceptAllLabels}>Αποδοχή όλων των προτάσεων</button>}
          <p className="hint">Για την πρόταση στέλνονται μικρές εκδοχές των φωτογραφιών στην υπηρεσία Gemini της Google, μόνο όταν πατήσετε το κουμπί. Δεν αποθηκεύονται από το HOME88. Οι ετικέτες που αποδέχεστε γίνονται το εναλλακτικό κείμενο των φωτογραφιών.</p>
        </div>
      )}
      {!done && (
        <label className="intake-later">
          <input type="checkbox" checked={session.photosLater} disabled={busy} onChange={(e) => void edit({ type: "settings", photosLater: e.target.checked })} /> Θα ανεβάσω φωτογραφίες αργότερα
        </label>
      )}
      {!done && photos.length > 0 && <p className="hint">Οι φωτογραφίες ανεβαίνουν μόλις αποθηκευτεί το πρόχειρο.</p>}
    </section>
  );

  const texts = (
    <section className="xcard ipanel" aria-label="Τίτλος και περιγραφή">
      <div className="ipanel__head">
        <h2>Τίτλος και περιγραφή</h2>
        {!done && <button type="button" className="btn btn--outline btn--sm" disabled={busy || !session.fields.propertyType} onClick={() => void suggest()}>Νέα πρόταση</button>}
      </div>
      <p className="hint">Γράφονται αυτόματα μόνο από στοιχεία που έχετε δώσει ή επιβεβαιώσει. Δεν αποθηκεύονται αν δεν τα εγκρίνετε.</p>
      <div className="itexts">
        {TEXT_KEYS.map((key) => {
          const f = session.fields[key];
          const spec = specOf(key);
          if (!spec) return null;
          const isEditing = editing?.key === key;
          return (
            <div key={key} className={f && !f.confirmed ? "itext is-proposal" : "itext"}>
              <div className="itext__head">
                <label htmlFor={`txt-${key}`}>{spec.label}</label>
                {f && <span className={f.confirmed ? "badge badge--ok" : ORIGIN_LABEL[f.origin].className}>{f.confirmed ? "Εγκρίθηκε" : `${ORIGIN_LABEL[f.origin].text} — δεν έχει εγκριθεί`}</span>}
              </div>
              {isEditing ? (
                <>
                  <textarea id={`txt-${key}`} rows={key.startsWith("description") ? 5 : 2} value={editing.value} onChange={(e) => setEditing({ key, value: e.target.value })} />
                  <span className="intake-edit">
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveEditing()}>Αποθήκευση</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Άκυρο</button>
                  </span>
                </>
              ) : (
                <>
                  <p className="intake-text">{f ? String(f.value) : <span className="muted">Δεν υπάρχει ακόμη πρόταση.</span>}</p>
                  {!done && (
                    <span className="intake-edit">
                      {f && !f.confirmed && <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void edit({ type: "confirm", key })}>Έγκριση</button>}
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing({ key, value: f ? String(f.value) : "" })}>{f ? "Επεξεργασία" : "Γράψτε"}</button>
                      {f && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void edit({ type: "clear", key })}>Απόρριψη</button>}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  const reviewSection = (
    <section className="xcard ipanel" aria-label="Έλεγχος">
      <h2>Έλεγχος</h2>
      <dl className="ireview">
        {[
          ["Είδος & τύπος", GROUPS.type, 1],
          ["Τιμή", GROUPS.price, 1],
          ["Τοποθεσία", GROUPS.location, 1],
          ["Εμβαδόν & κατάσταση", GROUPS.size, 1],
          ["Χαρακτηριστικά", [...mainKeys, ...featureKeys, ...extraShown.map((x) => x.key)], 2],
        ].map(([title, keys, target]) => {
          const shown = session.review.rows.filter((r) => (keys as string[]).includes(r.key));
          return (
            <div key={title as string}>
              <dt>{title as string} <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(target as StepIndex)}>Αλλαγή</button></dt>
              <dd>{shown.length ? shown.map((r) => `${r.label}: ${r.display}`).join(" · ") : <span className="muted">—</span>}</dd>
            </div>
          );
        })}
        <div>
          <dt>Ιδιοκτήτης <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(1)}>Αλλαγή</button></dt>
          <dd>{session.owner ? `${session.owner.label} · ${session.owner.reference}` : <span className="muted">Δεν έχει οριστεί</span>}</dd>
        </div>
        <div>
          <dt>Θέση στον χάρτη <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(1)}>Αλλαγή</button></dt>
          <dd>{session.location ? `${session.location.lat.toFixed(5)}, ${session.location.lng.toFixed(5)} · ${session.location.visibility === "exact" ? "ακριβής στον ιστότοπο" : session.location.visibility === "approximate" ? "κατά προσέγγιση στον ιστότοπο" : "μόνο για το γραφείο"}` : <span className="muted">Δεν έχει οριστεί</span>}</dd>
        </div>
        <div>
          <dt>Φωτογραφίες <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(3)}>Αλλαγή</button></dt>
          <dd>{photos.length ? `${photos.length} · εξώφυλλο: ${photos[0]!.file.name}` : session.photosLater ? "Αργότερα" : <span className="muted">Καμία</span>}</dd>
        </div>
      </dl>
      {session.review.ignored.length > 0 && <p className="hint">Δεν ισχύουν για αυτόν τον τύπο και δεν θα αποθηκευτούν: {session.review.ignored.join(", ")}.</p>}
    </section>
  );

  const saveSection = (
    <section className="xcard ipanel" aria-label="Αποθήκευση">
      {!done ? (
        <>
          <h2>Αποθήκευση πρόχειρου</h2>
          <h3 className="ilevel">Απαιτείται για να αποθηκευτεί το πρόχειρο</h3>
          {session.review.blockers.length > 0 ? (
            <ul className="notice notice--danger intake-list">{session.review.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : (
            <p className="ok-line">✓ Όλα έτοιμα για αποθήκευση ως πρόχειρο.</p>
          )}
          {session.review.warnings.length > 0 && (
            <>
              <h3 className="ilevel">Πριν την ενεργοποίηση ή για πληρέστερη καταχώριση (δεν εμποδίζουν την αποθήκευση)</h3>
              <ul className="notice intake-list">{session.review.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </>
          )}
          <p className="hint">Δημιουργείται ως πρόχειρο με τον κανονικό κωδικό H88. Δεν δημοσιεύεται στον ιστότοπο ούτε σε portals· η δημοσίευση γίνεται χωριστά, από το ακίνητο.</p>
        </>
      ) : (
        <>
          <h2>Το πρόχειρο αποθηκεύτηκε{created?.reference ? ` · ${created.reference}` : ""}</h2>
          <p>Δεν έχει δημοσιευτεί.</p>
          {photos.length > 0 && progress && (
            <p className="hint" role="status" aria-live="polite">
              Φωτογραφίες: {photos.filter((p) => progress[p.id]?.state === "done").length} / {photos.length} ανέβηκαν
              {photos.some((p) => !["done", "failed"].includes(progress[p.id]?.state ?? "queued")) ? "…" : "."}
            </p>
          )}
          {photos.length > 0 && photoFailures > 0 && !busy && (
            <div className="notice notice--danger" role="alert">
              Το ακίνητο αποθηκεύτηκε, αλλά {photoFailures} φωτογραφίες δεν ανέβηκαν. Δεν θα δημιουργηθεί δεύτερο ακίνητο.
              <div style={{ marginTop: 8 }}><button type="button" className="btn btn--primary btn--sm" onClick={() => void retryPhotos()}>Επανάληψη των φωτογραφιών που απέτυχαν</button></div>
            </div>
          )}
          {ownerOutcome === "linked" && session.owner && <p className="hint">Ο ιδιοκτήτης {session.owner.label} συνδέθηκε με το ακίνητο.</p>}
          {ownerOutcome === "skipped" && <p className="notice notice--danger" role="alert">Το πρόχειρο αποθηκεύτηκε, αλλά ο ιδιοκτήτης δεν συνδέθηκε (η επαφή δεν υπάρχει πια). Συνδέστε τον από το ακίνητο.</p>}
          {created && <Link className="btn btn--primary btn--lg" href={`/properties/${created.id}`}>Μετάβαση στο ακίνητο</Link>}
        </>
      )}
    </section>
  );


  return (
    <div className="xintake">
      <div className="xstatusline">
        <span className={done ? "xpill xpill--ok" : "xpill"}>{done ? "Πρόχειρο ακίνητο αποθηκεύτηκε" : "Σε συμπλήρωση"}</span>
        <span className="hint">Δεν δημοσιεύεται πουθενά</span>
        {!online && <span className="xpill xpill--warn"><Icon name="cloudOff" size={14} /> Εκτός σύνδεσης</span>}
      </div>
      <SyncStatus />
      {offlineNow && !done && (
        <div className="xalert xalert--warn xoffline" role="status">
          <Icon name="cloudOff" size={18} />
          <span>Δεν υπάρχει σύνδεση. Οι φωτογραφίες και το κείμενο που δεν στάλθηκε κρατιούνται στη συσκευή. Συνεχίστε εκτός σύνδεσης· οι αλλαγές στέλνονται μόλις επανέλθει.</span>
          <ActionButton variant="secondary" size="sm" icon="keyboard" onClick={() => void continueOffline()}>Συνέχεια εκτός σύνδεσης</ActionButton>
        </div>
      )}
      {deviceNote && <p className="xalert xalert--info" role="status"><Icon name="check" size={18} /><span>{deviceNote}</span></p>}
      <Stepper current={step} states={stepStates} onGo={go} />
      {error && !offlineNow && <p className="xalert xalert--danger" role="alert"><Icon name="alert" size={18} /><span>{error}</span></p>}

      {step === 0 && (
        <div className="xgrid">
          <div className="xmain">
            {voiceCard}
            {helpCard}
          </div>
          <CapturePanel session={session} onGo={(i) => go(i)} onShortcut={insertText} disabled={locked} />
        </div>
      )}

      {step === 1 && (
        <div className="igrid igrid--even">
          <section className="xcard ipanel" aria-label="Είδος και τύπος"><h3>Είδος & τύπος ακινήτου</h3>{rows(GROUPS.type)}</section>
          <section className="xcard ipanel" aria-label="Τιμή"><h3>Τιμή</h3>{rows(GROUPS.price)}</section>
          <section className="xcard ipanel" aria-label="Τοποθεσία"><h3>Τοποθεσία</h3>{rows(GROUPS.location)}</section>
          <section className="xcard ipanel" aria-label="Εμβαδόν"><h3>Εμβαδόν & κατάσταση</h3>{rows(GROUPS.size)}</section>
          {locationCard}
          {ownerCard}
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          {!layout ? (
            <p className="xalert" role="status"><Icon name="info" size={18} /><span>Δηλώστε πρώτα τον τύπο ακινήτου στα «Βασικά στοιχεία»: τα χαρακτηριστικά εξαρτώνται από αυτόν.</span></p>
          ) : (
            <>
              <section className="xcard ipanel" aria-label={layout.title}>
                <h2>{layout.title}</h2>
                <div className="ifields">{rows(mainKeys)}</div>
              </section>
              {featureKeys.length > 0 && (
                <section className="xcard ipanel" aria-label="Παροχές">
                  <h3>Παροχές</h3>
                  <p className="hint">Πατήστε όσα υπάρχουν.</p>
                  <FeatureChips specs={specsOf(featureKeys)} session={session} disabled={locked} onSet={setField} />
                </section>
              )}
              <section className="xcard ipanel" aria-label="Περισσότερα χαρακτηριστικά">
                <h3>Περισσότερα χαρακτηριστικά</h3>
                {extraShown.length > 0 && <div className="ifields">{extraShown.map((spec) => <FieldRow key={spec.key} spec={spec} session={session} disabled={locked} onSet={setField} onConfirm={confirm} />)}</div>}
                {!done && <FieldPicker specs={pickable} onPick={(key) => setPickedKeys((cur) => [...cur, key])} />}
              </section>
            </>
          )}
        </div>
      )}

      {step === 3 && photoSection}

      {step === 4 && (
        <div className="stack">
          {reviewSection}
          {!done && texts}
          {saveSection}
        </div>
      )}

      <div className="xbar" role="group" aria-label="Αποθήκευση και πλοήγηση">
        <span className="xbar__back">
          {step > 0 && <ActionButton variant="ghost" icon="arrowLeft" onClick={() => go((step - 1) as StepIndex)}>Πίσω</ActionButton>}
        </span>
        <p className="xbar__status" role="status" aria-live="polite">
          <span className="xbar__saved">
            {busy ? <><span className="xbtn__spinner xbtn__spinner--dark" aria-hidden="true" /> Αποθήκευση…</> : savedLabel ? <><Icon name="check" size={15} /> Αποθηκεύτηκε αυτόματα · {savedLabel}</> : null}
          </span>
          {(nextBlocked || saveBlocked) && !busy && <span className="xbar__why">{nextBlocked ?? `Για αποθήκευση ως πρόχειρο ακίνητο: ${saveBlocked}`}</span>}
        </p>
        <span className="xbar__actions">
          {!done && offlineNow ? (
            <ActionButton variant={step === 4 ? "primary" : "secondary"} icon="save" onClick={() => void saveOnDevice()} title="Κρατιέται στη συσκευή και αποθηκεύεται ως πρόχειρο ακίνητο μόλις επανέλθει η σύνδεση">
              Αποθήκευση στη συσκευή
            </ActionButton>
          ) : !done ? (
            <ActionButton
              variant={step === 4 ? "primary" : "secondary"}
              icon="save"
              loading={busy && step === 4}
              loadingLabel="Αποθήκευση…"
              done={saveFlash}
              doneLabel="Αποθηκεύτηκε"
              disabled={busy || Boolean(saveBlocked)}
              onClick={() => void saveDraft()}
              title={saveBlocked ?? "Δημιουργεί το ακίνητο ως πρόχειρο, χωρίς δημοσίευση"}
            >
              Αποθήκευση πρόχειρου
            </ActionButton>
          ) : (
            created && <ActionLink variant="secondary" icon="building" href={`/properties/${created.id}`}>Καρτέλα ακινήτου</ActionLink>
          )}
          {step < 4 && (
            <ActionButton variant="primary" iconAfter="arrowRight" disabled={Boolean(nextBlocked)} onClick={() => go((step + 1) as StepIndex)} title={nextBlocked ?? undefined}>
              Συνέχεια
            </ActionButton>
          )}
        </span>
      </div>
      {examplesDialog}
    </div>
  );
}
