"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { PendingMedia, type PendingFile } from "@/components/PendingMedia";
import { browserIO, makeLabelPreview, persistOrder, saveAltText } from "@/lib/browser-upload";
import { listenForSpeech, type Listener } from "@/lib/hands-free";
import {
  intakeApi, IntakeRequestError, type IntakeEdit, type IntakeOrigin, type IntakeSession, type OwnerCandidate,
} from "@/lib/intake-client";
import { photoStore } from "@/lib/pending-photos";
import { altUpdates, isLabelCode, PHOTO_LABELS, type PhotoLabel } from "@/lib/photo-labels";
import { uploadAll, type UploadUpdate } from "@/lib/upload-queue";
import { MAX_RECORDING_SECONDS, recordingToWav, toBase64 } from "@/lib/wav";

type Catalog = IntakeSession["catalog"][number];
type Language = "auto" | "el" | "en";
type Recording = "idle" | "recording" | "transcribing";

const ORIGIN_LABEL: Record<IntakeOrigin, { text: string; className: string }> = {
  AGENT_STATED: { text: "Από εσάς", className: "badge badge--ok" },
  AGENT_MANUAL: { text: "Από εσάς", className: "badge badge--ok" },
  SYSTEM_DERIVED: { text: "Αυτόματο — επιβεβαιώστε", className: "badge badge--warn" },
  AI_SUGGESTED: { text: "Πρόταση AI — επιβεβαιώστε", className: "badge badge--warn" },
};

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

function ValueInput({ spec, value, onChange, id }: { spec: Catalog; value: string; onChange: (v: string) => void; id: string }) {
  if (spec.kind === "bool") {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="true">Ναι</option>
        <option value="false">Όχι</option>
      </select>
    );
  }
  if (spec.kind === "select") {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {spec.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  const numeric = spec.kind === "int" || spec.kind === "decimal";
  return (
    <input
      id={id}
      type={spec.kind === "date" ? "date" : "text"}
      inputMode={numeric ? (spec.kind === "int" ? "numeric" : "decimal") : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function IntakeAssistant({ maxUploadBytes, resumeId }: { maxUploadBytes: number; resumeId?: string }) {
  const [phase, setPhase] = useState<"loading" | "picker" | "session">("loading");
  const [available, setAvailable] = useState(true);
  const [resumable, setResumable] = useState<Array<{ id: string; updatedAt: string; fieldCount: number; summary: string | null }>>([]);
  const [session, setSession] = useState<IntakeSession | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording>("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [photos, setPhotos] = useState<PendingFile[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadUpdate> | undefined>();
  const [created, setCreated] = useState<{ id: string; reference: string } | null>(null);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [adding, setAdding] = useState("");
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

  const fail = useCallback((e: unknown) => setError(e instanceof IntakeRequestError ? e.message : "Κάτι πήγε στραβά. Δοκιμάστε ξανά."), []);

  // --- Loading and resuming ----------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [status, list] = await Promise.all([intakeApi.status(), intakeApi.list()]);
        if (!alive) return;
        setAvailable(status.available);
        setResumable(list.sessions);
        if (resumeId) {
          const loaded = await intakeApi.get(resumeId);
          if (!alive) return;
          openSession(loaded.session);
        } else setPhase("picker");
      } catch (e) {
        if (!alive) return;
        fail(e);
        setPhase("picker");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSession(next: IntakeSession) {
    setSession(next);
    setInput(readDraft(next.id));
    setCreated(next.propertyId ? { id: next.propertyId, reference: "" } : null);
    setLabels(readLabels(next.id));
    setPhase("session");
    void restorePhotos(next);
  }

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

  async function begin(language: Language = "auto") {
    setBusy(true);
    setError(null);
    try {
      openSession((await intakeApi.start(language)).session);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
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
  async function startRecording(options: { handsFree?: boolean } = {}) {
    if (!session) return;
    unlockAudio();
    setError(null);
    setVoiceNote(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceNote("Ο browser δεν υποστηρίζει ηχογράφηση. Γράψτε το μήνυμά σας.");
      if (options.handsFree) stopHandsFree();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setVoiceNote(denied ? "Δεν δόθηκε άδεια για το μικρόφωνο. Επιτρέψτε την από τις ρυθμίσεις του browser ή γράψτε." : "Δεν βρέθηκε μικρόφωνο. Γράψτε το μήνυμά σας.");
      if (options.handsFree) stopHandsFree();
      return;
    }
    if (options.handsFree && !handsFreeRef.current) {
      stream.getTracks().forEach((t) => t.stop()); // switched off while the permission prompt was open
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
      stream.getTracks().forEach((t) => t.stop());
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (discardRef.current || (options.handsFree && !heardSpeechRef.current)) {
        setRecording("idle");
        if (options.handsFree && !discardRef.current) noteEmptyRound();
        return;
      }
      emptyRounds.current = 0;
      void transcribeClip(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), options.handsFree === true);
    };
    recorder.start();
    setRecording("recording");
    stopTimer.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_SECONDS * 1000);
    if (options.handsFree) {
      try {
        listenerRef.current = listenForSpeech(stream, (event) => {
          if (event === "speech_start") heardSpeechRef.current = true;
          else if (recorder.state === "recording") recorder.stop(); // speech_end, too_long, or nobody spoke
        });
      } catch {
        setVoiceNote("Ο browser δεν υποστηρίζει συνομιλία χωρίς χέρια. Χρησιμοποιήστε το κουμπί του μικροφώνου.");
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

  async function transcribeClip(blob: Blob, auto: boolean) {
    if (!session) return;
    if (blob.size < 1500) {
      setRecording("idle");
      if (auto) noteEmptyRound();
      else setVoiceNote("Η ηχογράφηση ήταν πολύ σύντομη. Πατήστε το μικρόφωνο και μιλήστε.");
      return;
    }
    setRecording("transcribing");
    try {
      const wav = await recordingToWav(blob);
      const out = await intakeApi.transcribe(session.id, toBase64(wav), "audio/wav", session.language);
      // The transcript lands in the editable box. By hand nothing is applied until the agent sends it;
      // in hands-free mode it is sent after a short, visible countdown that any tap or edit cancels.
      setInput((cur) => (cur && !auto ? `${cur} ${out.text}` : out.text));
      if (auto && handsFreeRef.current) beginAutoSend(out.text);
    } catch (e) {
      if (e instanceof IntakeRequestError) setVoiceNote(e.message);
      else setVoiceNote("Δεν μπόρεσα να διαβάσω την ηχογράφηση. Δοκιμάστε ξανά ή γράψτε.");
      if (auto) {
        // A refusal (no key, rate limit) will not fix itself: stop instead of retrying in a loop.
        if (e instanceof IntakeRequestError && e.code !== "no_speech") stopHandsFree();
        else noteEmptyRound();
      }
    } finally {
      setRecording("idle");
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
    if (!session || handsFreeRef.current) return;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Conversation ---------------------------------------------------------------
  async function send(text = input) {
    if (!session || !text.trim() || busy) return;
    unlockAudio();
    clearAutoSend();
    setBusy(true);
    setError(null);
    try {
      const out = await intakeApi.turn(session.id, text.trim(), session.revision);
      setSession(out.session);
      setInput("");
      writeDraft(session.id, "");
      const played = out.session.muted ? Promise.resolve() : speak(out.session.id);
      if (handsFreeRef.current) void played.then(() => resumeRef.current());
    } catch (e) {
      if (handsFreeRef.current) stopHandsFree(); // never keep sending into an error
      if (e instanceof IntakeRequestError && e.status === 409) {
        const fresh = await intakeApi.get(session.id).catch(() => null);
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

  if (phase === "picker" || !session) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        {error && <p className="notice notice--danger" role="alert">{error}</p>}
        {!available && (
          <p className="notice" role="status">
            Η φωνητική υπηρεσία δεν έχει ρυθμιστεί ακόμη στον server. Μπορείτε να χρησιμοποιήσετε την καταχώριση με πεδία, ή τη{" "}
            <Link href="/properties/new">κανονική φόρμα</Link>.
          </p>
        )}
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>Νέο ακίνητο με φωνή ή κείμενο</h2>
          <p className="muted">
            Περιγράψτε το ακίνητο μιλώντας ή γράφοντας, στα ελληνικά ή στα αγγλικά. Ο βοηθός συμπληρώνει τα πεδία, ρωτά ό,τι λείπει και
            δεν δημοσιεύει τίποτα· εσείς ελέγχετε και εγκρίνετε.
          </p>
          <p className="hint">Η ηχογράφησή σας αποστέλλεται στην υπηρεσία Gemini της Google για μετατροπή σε κείμενο και δεν αποθηκεύεται από το HOME88.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void begin("auto")}>Νέα καταχώριση</button>
            <Link href="/properties/new" className="btn btn--outline btn--lg">Κανονική φόρμα</Link>
          </div>
        </div>
        {resumable.length > 0 && (
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Συνέχεια από εκεί που μείνατε</h3>
            <ul className="intake-resume">
              {resumable.map((r) => (
                <li key={r.id}>
                  <span>{r.summary ?? "Χωρίς περιγραφή ακόμη"} <span className="hint">· {r.fieldCount} πεδία · {new Date(r.updatedAt).toLocaleString("el-GR")}</span></span>
                  <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void resume(r.id)}>Συνέχεια</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const done = session.status === "CREATED" || Boolean(created);
  const lastAssistant = [...session.turns].reverse().find((t) => t.role === "assistant");
  const addable = session.catalog.filter((c) => !session.fields[c.key] && !["titleEl", "titleEn", "descriptionEl", "descriptionEn"].includes(c.key));
  const textKeys = ["titleEl", "titleEn", "descriptionEl", "descriptionEn"] as const;
  const specOf = (key: string) => session.catalog.find((c) => c.key === key);
  const photoFailures = photos.filter((p) => progress?.[p.id]?.state === "failed").length;

  return (
    <div className="intake">
      <div className="between" style={{ marginBottom: 12 }}>
        <div>
          <span className="badge badge--info">Πρόχειρο</span> <span className="hint">Δεν δημοσιεύεται πουθενά</span>
        </div>
        <div className="intake-toolbar" role="group" aria-label="Γλώσσα και ήχος">
          {(["auto", "el", "en"] as const).map((l) => (
            <button key={l} type="button" className={session.language === l ? "btn btn--primary btn--sm" : "btn btn--outline btn--sm"} disabled={busy || done} onClick={() => void edit({ type: "settings", language: l })} aria-pressed={session.language === l}>
              {l === "auto" ? "Αυτόματα" : l === "el" ? "Ελληνικά" : "English"}
            </button>
          ))}
          <button type="button" className="btn btn--outline btn--sm" disabled={busy || done} onClick={() => void edit({ type: "settings", muted: !session.muted })} aria-pressed={session.muted}>
            {session.muted ? "🔇 Σίγαση" : "🔊 Φωνή"}
          </button>
          <button
            type="button"
            className={handsFree ? "btn btn--primary btn--sm" : "btn btn--outline btn--sm"}
            disabled={done || !available || (busy && !handsFree)}
            onClick={() => (handsFree ? stopHandsFree() : startHandsFree())}
            aria-pressed={handsFree}
            title="Μιλάτε χωρίς να πατάτε κουμπί: ο βοηθός ακούει, απαντά και ξανακούει."
          >
            {handsFree ? "🎧 Χωρίς χέρια: ενεργό" : "🎧 Χωρίς χέρια"}
          </button>
        </div>
      </div>

      {error && <p className="notice notice--danger" role="alert">{error}</p>}
      {voiceNote && <p className="notice" role="status">{voiceNote}</p>}
      {handsFree && (
        <div className="notice intake-handsfree" role="status" aria-live="polite">
          {autoSend ? (
            <>
              <span>Αποστολή σε {autoSend.left}…</span>
              <span className="intake-pending__buttons">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => { clearAutoSend(); stopRecording(); }}>Ακύρωση — θα το διορθώσω</button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void send(autoSend.text)}>Στείλε τώρα</button>
              </span>
            </>
          ) : recording === "recording" ? (
            <span>Ακούω… μιλήστε και σταματήστε όταν τελειώσετε.</span>
          ) : recording === "transcribing" ? (
            <span>Μετατροπή σε κείμενο…</span>
          ) : busy ? (
            <span>Σκέφτομαι…</span>
          ) : input.trim() ? (
            <>
              <span>Διορθώστε το κείμενο και πατήστε Αποστολή· μετά την απάντηση θα ακούω ξανά.</span>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => { setInput(""); resumeListening(); }}>Άκου ξανά από την αρχή</button>
            </>
          ) : (
            <>
              <span>Συνομιλία χωρίς χέρια ενεργή. Θα ακούσω ξανά μόλις απαντήσω.</span>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => resumeListening()}>🎤 Άκου τώρα</button>
            </>
          )}
        </div>
      )}

      <section className="intake-log" ref={logRef} aria-label="Συνομιλία" aria-live="polite">
        {session.turns.map((t, i) => (
          <div key={`${t.at}-${i}`} className={t.role === "agent" ? "intake-msg intake-msg--agent" : "intake-msg"}>
            <span className="intake-msg__who">{t.role === "agent" ? "Εσείς" : "Βοηθός"}</span>
            <p>{t.text}</p>
            {t.role === "assistant" && t === lastAssistant && !session.muted && (
              <button type="button" className={needsTap ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm"} onClick={() => { unlockAudio(); void speak(session.id); }}>
                ▶ Ακούστε
              </button>
            )}
          </div>
        ))}
      </section>

      {session.pending.map((p) => (
        <div key={p.key} className="notice intake-pending" role="group" aria-label={`Επιβεβαίωση: ${p.label}`}>
          <span>
            {p.reason === "conflict" && p.current ? <>{p.label}: <s>{p.current}</s> → <strong>{p.proposed}</strong>;</> : <>{p.label}: <strong>{p.proposed}</strong>. Είναι σωστό;</>}
          </span>
          <span className="intake-pending__buttons">
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void edit({ type: "resolve", key: p.key, accept: true })}>Ναι</button>
            <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void edit({ type: "resolve", key: p.key, accept: false })}>Όχι</button>
          </span>
        </div>
      ))}

      {!done && (
        <div className="intake-composer">
          <label className="sr-only" htmlFor="intake-text">Μήνυμα ή απομαγνητοφώνηση (μπορείτε να τη διορθώσετε)</label>
          <textarea
            id="intake-text"
            rows={3}
            value={input}
            placeholder={recording === "recording" ? "Ηχογράφηση… πατήστε ξανά για να σταματήσει." : recording === "transcribing" ? "Μετατροπή σε κείμενο…" : "Μιλήστε ή γράψτε. Μπορείτε να διορθώσετε το κείμενο πριν το στείλετε."}
            disabled={busy || recording === "transcribing"}
            onChange={(e) => { if (autoSend) clearAutoSend(); setInput(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
          />
          <div className="intake-composer__buttons">
            <button
              type="button"
              className={recording === "recording" ? "btn btn--danger btn--lg" : "btn btn--outline btn--lg"}
              disabled={busy || recording === "transcribing" || !available}
              onClick={() => (recording === "recording" ? stopRecording() : void startRecording())}
              aria-pressed={recording === "recording"}
            >
              {recording === "recording" ? "⏹ Σταμάτημα" : recording === "transcribing" ? "…" : "🎤 Μίλησε"}
            </button>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy || !input.trim() || !available} onClick={() => void send()}>Αποστολή</button>
          </div>
          <div className="intake-quick">
            {session.asked && (
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void edit({ type: "skip", key: session.asked!.key })}>Παράλειψη: {session.asked.label}</button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void edit({ type: "undo" })}>↶ Πίσω</button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void edit({ type: "settings", stage: session.stage === "review" ? "collect" : "review" })}>
              {session.stage === "review" ? "Συνέχεια ερωτήσεων" : "Πάμε στη σύνοψη"}
            </button>
          </div>
        </div>
      )}

      <section className="card intake-panel" aria-label="Η καταχώρησή σας">
        <h2 style={{ marginTop: 0 }}>Η καταχώρησή σας</h2>
        {session.review.rows.length === 0 && <p className="muted">Δεν έχει καταχωριστεί τίποτα ακόμη.</p>}
        <ul className="intake-rows">
          {session.review.rows.map((row) => {
            const spec = specOf(row.key);
            const isEditing = editing?.key === row.key;
            return (
              <li key={row.key}>
                <div className="intake-rows__main">
                  <strong>{row.label}</strong>
                  {isEditing && spec ? (
                    <span className="intake-edit">
                      <ValueInput spec={spec} id={`edit-${row.key}`} value={editing.value} onChange={(v) => setEditing({ key: row.key, value: v })} />
                      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveEditing()}>Αποθήκευση</button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Άκυρο</button>
                    </span>
                  ) : (
                    <span>{row.display}</span>
                  )}
                </div>
                <div className="intake-rows__meta">
                  <span className={ORIGIN_LABEL[row.origin].className}>{row.needsConfirmation ? ORIGIN_LABEL[row.origin].text : "Από εσάς"}</span>
                  {!done && spec && !isEditing && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing({ key: row.key, value: String(session.fields[row.key]?.value ?? "") })}>Αλλαγή</button>
                  )}
                  {!done && row.needsConfirmation && (
                    <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void edit({ type: "confirm", key: row.key })}>Επιβεβαίωση</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {!done && addable.length > 0 && (
          <div className="intake-add">
            <label htmlFor="intake-add">Προσθήκη πεδίου</label>
            <select id="intake-add" value={adding} onChange={(e) => { setAdding(e.target.value); const spec = specOf(e.target.value); if (spec) setEditing({ key: spec.key, value: "" }); }}>
              <option value="">Επιλέξτε…</option>
              {addable.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
        )}
        {!done && editing && !session.fields[editing.key] && specOf(editing.key) && (
          <div className="intake-edit" style={{ marginTop: 8 }}>
            <strong>{specOf(editing.key)!.label}</strong>
            <ValueInput spec={specOf(editing.key)!} id={`new-${editing.key}`} value={editing.value} onChange={(v) => setEditing({ key: editing.key, value: v })} />
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || !editing.value.trim()} onClick={() => void saveEditing().then(() => setAdding(""))}>Προσθήκη</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditing(null); setAdding(""); }}>Άκυρο</button>
          </div>
        )}

        {session.review.ignored.length > 0 && <p className="hint">Δεν ισχύουν για αυτόν τον τύπο και δεν θα αποθηκευτούν: {session.review.ignored.join(", ")}.</p>}
        {session.review.missing.length > 0 && <p className="hint">Λείπουν: {session.review.missing.join(", ")}. Μπορείτε να τα συμπληρώσετε αργότερα.</p>}
      </section>

      {!done && (
        <section className="card intake-panel" aria-label="Τίτλος και περιγραφή">
          <div className="between">
            <h2 style={{ margin: 0 }}>Τίτλος και περιγραφή</h2>
            <button type="button" className="btn btn--outline btn--sm" disabled={busy || !session.fields.propertyType} onClick={() => void suggest()}>Πρόταση από τα στοιχεία μου</button>
          </div>
          <p className="hint">Οι προτάσεις γράφονται μόνο από όσα έχετε επιβεβαιώσει και δεν αποθηκεύονται αν δεν τις εγκρίνετε.</p>
          {textKeys.map((key) => {
            const f = session.fields[key];
            const spec = specOf(key);
            if (!spec) return null;
            const isEditing = editing?.key === key;
            return (
              <div key={key} className="field">
                <label htmlFor={`txt-${key}`}>{spec.label}</label>
                {isEditing ? (
                  <>
                    <textarea id={`txt-${key}`} rows={key.startsWith("description") ? 4 : 1} value={editing.value} onChange={(e) => setEditing({ key, value: e.target.value })} />
                    <span className="intake-edit">
                      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveEditing()}>Αποθήκευση</button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Άκυρο</button>
                    </span>
                  </>
                ) : (
                  <>
                    <p className="intake-text">{f ? String(f.value) : <span className="muted">—</span>}</p>
                    <span className="intake-edit">
                      {f && <span className={ORIGIN_LABEL[f.origin].className}>{f.confirmed ? "Από εσάς" : ORIGIN_LABEL[f.origin].text}</span>}
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing({ key, value: f ? String(f.value) : "" })}>{f ? "Αλλαγή" : "Γράψτε"}</button>
                      {f && !f.confirmed && <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void edit({ type: "confirm", key })}>Έγκριση</button>}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="card intake-panel" aria-label="Ιδιοκτήτης">
        <h2 style={{ marginTop: 0 }}>Ιδιοκτήτης</h2>
        <p className="hint">
          Επιλέξτε μια υπάρχουσα επαφή. Για την προστασία των προσωπικών δεδομένων μην υπαγορεύετε τηλέφωνα ή email στον βοηθό· ψάξτε την επαφή εδώ
          ή δημιουργήστε πρώτα τη νέα επαφή.
        </p>
        {session.owner ? (
          <p>
            <strong>{session.owner.label}</strong> <span className="hint">· {session.owner.reference}</span>
            {!done && (
              <>
                {" "}
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void chooseOwner(null)}>Αφαίρεση</button>
              </>
            )}
          </p>
        ) : (
          <p className="muted">Δεν έχει οριστεί ιδιοκτήτης.</p>
        )}
        {!done && (
          <>
            <div className="intake-edit">
              <label className="sr-only" htmlFor="owner-q">Αναζήτηση επαφής</label>
              <input
                id="owner-q"
                type="search"
                value={ownerQuery}
                placeholder="Όνομα, εταιρεία, κωδικός επαφής, τηλέφωνο ή email"
                onChange={(e) => setOwnerQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void searchOwner(); }}
              />
              <button type="button" className="btn btn--outline btn--sm" disabled={busy || ownerQuery.trim().length < 2} onClick={() => void searchOwner()}>Αναζήτηση</button>
              <Link className="btn btn--ghost btn--sm" href="/contacts/new" target="_blank" rel="noopener">Νέα επαφή ↗</Link>
            </div>
            {ownerResults && ownerResults.length === 0 && <p className="hint">Δεν βρέθηκε επαφή. Δημιουργήστε την από το «Νέα επαφή» και αναζητήστε ξανά.</p>}
            {ownerResults && ownerResults.length > 0 && (
              <ul className="intake-rows">
                {ownerResults.map((c) => (
                  <li key={c.id}>
                    <div className="intake-rows__main">
                      <strong>{c.name}</strong>
                      <span className="hint">{[c.reference, c.city, c.phoneHint].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="intake-rows__meta">
                      <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => void chooseOwner(c.id)}>Επιλογή</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">Ο ιδιοκτήτης συνδέεται όταν αποθηκευτεί το πρόχειρο.</p>
          </>
        )}
      </section>

      <section className="card intake-panel" aria-label="Φωτογραφίες">
        <h2 style={{ marginTop: 0 }}>Φωτογραφίες</h2>
        <p className="hint">Φωτογραφίστε τώρα ή προσθέστε τις αργότερα. Παραμένουν ιδιωτικές μέχρι να εγκριθούν.</p>
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
            {Object.values(labels).some((l) => !l.accepted) && (
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={acceptAllLabels}>Αποδοχή όλων των προτάσεων</button>
            )}
            <p className="hint">
              Για την πρόταση στέλνονται μικρές εκδοχές των φωτογραφιών στην υπηρεσία Gemini της Google, μόνο όταν πατήσετε το κουμπί. Δεν αποθηκεύονται από το HOME88. Οι ετικέτες που αποδέχεστε γίνονται
              το εναλλακτικό κείμενο των φωτογραφιών.
            </p>
          </div>
        )}
        {!done && (
          <label className="intake-later">
            <input type="checkbox" checked={session.photosLater} disabled={busy} onChange={(e) => void edit({ type: "settings", photosLater: e.target.checked })} /> Θα ανεβάσω φωτογραφίες αργότερα
          </label>
        )}
        {!done && photos.length > 0 && <p className="hint">Οι φωτογραφίες ανεβαίνουν μόλις αποθηκευτεί το πρόχειρο. Μην κλείσετε τη σελίδα μέχρι τότε.</p>}
      </section>

      <section className="card intake-panel" aria-label="Αποθήκευση">
        {!done ? (
          <>
            <h2 style={{ marginTop: 0 }}>Αποθήκευση πρόχειρου</h2>
            {session.review.blockers.length > 0 && (
              <ul className="notice notice--danger intake-list">
                {session.review.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
            {session.review.warnings.length > 0 && (
              <ul className="notice intake-list">
                {session.review.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <button type="button" className="btn btn--primary btn--lg btn--block" disabled={busy || !session.review.ready} onClick={() => void saveDraft()}>Αποθήκευση πρόχειρου ακινήτου</button>
            <p className="hint">Δημιουργείται ως πρόχειρο με τον κανονικό κωδικό H88. Δεν δημοσιεύεται στον ιστότοπο ούτε σε portals.</p>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>Το πρόχειρο αποθηκεύτηκε{created?.reference ? ` · ${created.reference}` : ""}</h2>
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
    </div>
  );
}
