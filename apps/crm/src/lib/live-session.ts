/**
 * The live voice conversation with Gemini, as a small state machine.
 *
 * The browser streams microphone audio straight to Google's Live API over a WebSocket opened with a short-lived
 * token from our API, plays the spoken answers, and shows both sides as text. When the model reports facts (its
 * one tool), they are sent to our API, which validates them; only the API's answer (what was recorded, what
 * needs a yes/no) goes back to the model and onto the screen. The model never writes anything itself.
 *
 * Everything that touches the browser (socket, microphone, speakers) and the network is injected, so this file
 * is tested with fakes.
 */

import type { IntakeSession } from "./intake-client";

export type LiveState =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "thinking"
  | "speaking"
  | "waiting"
  | "reconnecting"
  | "disconnected"
  | "error"
  | "ended";

export type LiveLine = { id: number; role: "agent" | "assistant"; text: string; final: boolean; interrupted?: boolean };

export type LiveTokenResponse = {
  token: string;
  url: string;
  model: string;
  setup: Record<string, unknown>;
  kickoff: string;
  expiresAt: string;
  audio: { inputSampleRate: number; outputSampleRate: number; inputMimeType: string };
};

export type LiveToolResult = {
  recorded: Array<{ field: string; label: string; value: string }>;
  toConfirm: Array<{ field: string; label: string; proposed: string; current: string | null; question: string }>;
  rejected: Array<{ field: string; reason: string }>;
  notes: string[];
  next: { action: "ask"; field: string; label: string; question: string } | { action: "confirm"; field: string; question: string } | { action: "review"; missing: string[]; blockers: string[] };
  suggestedReply: string;
};

/** The parts of a WebSocket the conversation uses. */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string; wasClean?: boolean }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type LiveAudioPort = {
  /** Called synchronously inside the tap that starts the conversation (mobile browsers only allow audio then). */
  unlock(): void;
  /** Asks for the microphone and starts sending 16 kHz chunks (base64 PCM) with their loudness. */
  start(onChunk: (base64: string, level: number) => void): Promise<void>;
  stop(): void;
  /** Queues 24 kHz base64 PCM for playback. */
  play(base64: string): void;
  /** Stops what is playing at once (the agent interrupted). */
  flush(): void;
  playing(): boolean;
  /** Called when everything queued has finished playing. */
  onIdle(cb: () => void): void;
};

export type LiveDeps = {
  token(resumeHandle?: string): Promise<LiveTokenResponse>;
  sync(body: { lines: Array<{ role: "agent" | "assistant"; text: string }>; facts?: Record<string, unknown> }): Promise<{ session: IntakeSession; result: LiveToolResult | null }>;
  openSocket(url: string): SocketLike;
  audio: LiveAudioPort;
  /** Every change of state or transcript. */
  onChange(view: LiveView): void;
  /** The session as the server now holds it (after a validated update). */
  onSession(session: IntakeSession): void;
  /** Field keys the server just accepted, for a moment's highlight. */
  onRecorded?(keys: string[]): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

export type LiveView = {
  state: LiveState;
  lines: LiveLine[];
  muted: boolean;
  /** A calm, actionable message; never the provider's own text. */
  error: string | null;
  /** The last validated update, as the server answered it. */
  last: LiveToolResult | null;
  /** The server says the intake is ready for review. */
  reviewSuggested: boolean;
};

export const LIVE_TOOL = "record_property_facts";
const OPEN = 1;
const SETUP_TIMEOUT_MS = 15_000;
const TRANSCRIPT_FLUSH_MS = 1_500;
const MAX_RECONNECTS = 2;
/** The last words of the agent's sentence can arrive just after the tool call; they are the evidence for the facts. */
const TRANSCRIPT_SETTLE_MS = 350;

const MESSAGES = {
  connect: "Δεν ήταν δυνατή η σύνδεση με τον βοηθό. Δοκιμάστε ξανά ή συνεχίστε με ηχογράφηση ή πληκτρολόγηση.",
  lost: "Η σύνδεση με τον βοηθό διακόπηκε. Ό,τι καταγράφηκε είναι αποθηκευμένο· πατήστε «Επανασύνδεση» ή συνεχίστε γράφοντας.",
  refused: "Η υπηρεσία φωνής δεν δέχτηκε τη σύνδεση. Δοκιμάστε ξανά σε λίγο ή συνεχίστε με ηχογράφηση ή πληκτρολόγηση.",
  syncFailed: "Δεν αποθηκεύτηκαν τα τελευταία στοιχεία. Ο βοηθός θα σας ζητήσει να τα επαναλάβετε.",
};

/** Mic problems, in words an agent can act on. */
export function micErrorMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Δεν δόθηκε άδεια για το μικρόφωνο. Επιτρέψτε το από το εικονίδιο της διεύθυνσης (ή τις ρυθμίσεις του κινητού) και πατήστε ξανά «Έναρξη συνομιλίας» — ή συνεχίστε γράφοντας.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Δεν βρέθηκε μικρόφωνο σε αυτή τη συσκευή. Συνεχίστε γράφοντας.";
  if (name === "NotReadableError" || name === "AbortError") return "Το μικρόφωνο χρησιμοποιείται από άλλη εφαρμογή. Κλείστε την και δοκιμάστε ξανά.";
  if (name === "NotSupportedError") return "Αυτός ο browser δεν υποστηρίζει ζωντανή συνομιλία. Χρησιμοποιήστε ηχογράφηση ή πληκτρολόγηση.";
  return "Το μικρόφωνο δεν ξεκίνησε. Δοκιμάστε ξανά ή συνεχίστε γράφοντας.";
}

/** The Live API sends JSON as text or as binary frames; both are read the same way. */
export async function frameText(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as ArrayBufferView);
  if (typeof data === "object" && data !== null && "text" in data && typeof (data as Blob).text === "function") return (data as Blob).text();
  return null;
}

type ServerMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
};

export class LiveConversation {
  private view: LiveView = { state: "idle", lines: [], muted: false, error: null, last: null, reviewSuggested: false };
  private socket: SocketLike | null = null;
  private ready = false;
  /** This connection reached setupComplete at least once (a failure before that is a connection error). */
  private everReady = false;
  private stopped = false;
  private handle: string | null = null;
  private reconnects = 0;
  private nextId = 1;
  private synced = new Set<number>();
  private queue: Promise<unknown> = Promise.resolve();
  private inbox: Promise<unknown> = Promise.resolve();
  private cancelled = new Set<string>();
  private setupTimer: unknown = null;
  private flushTimer: unknown = null;
  private sentEndOfStream = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(private readonly deps: LiveDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    deps.audio.onIdle(() => {
      if (this.view.state === "speaking") this.set({ state: "waiting" });
    });
  }

  get snapshot(): LiveView {
    return this.view;
  }

  private set(patch: Partial<LiveView>) {
    this.view = { ...this.view, ...patch };
    this.deps.onChange(this.view);
  }

  /** Starts the conversation. Call from the tap itself (see LiveAudioPort.unlock). */
  async start(): Promise<void> {
    if (!["idle", "ended", "error", "disconnected"].includes(this.view.state)) return;
    this.deps.audio.unlock();
    this.stopped = false;
    this.reconnects = 0;
    this.set({ state: "connecting", error: null, reviewSuggested: false });
    try {
      // The microphone first: if it is refused, no token is spent.
      await this.deps.audio.start((chunk, level) => this.onMic(chunk, level));
    } catch (error) {
      this.set({ state: "error", error: micErrorMessage(error) });
      return;
    }
    await this.connect(null);
  }

  /** After a lost connection: a new token, resuming the same conversation when Google allows it. */
  async retry(): Promise<void> {
    if (this.stopped) return this.start();
    this.reconnects = 0;
    this.set({ state: "reconnecting", error: null });
    await this.connect(this.handle);
  }

  private async connect(resumeHandle: string | null): Promise<void> {
    this.ready = false;
    this.everReady = false;
    let token: LiveTokenResponse;
    try {
      token = await this.deps.token(resumeHandle ?? undefined);
    } catch (error) {
      if (this.stopped) return;
      const message = error instanceof Error && error.message ? error.message : MESSAGES.connect;
      this.set({ state: resumeHandle ? "disconnected" : "error", error: message });
      return;
    }
    if (this.stopped) return;
    let socket: SocketLike;
    try {
      socket = this.deps.openSocket(`${token.url}?access_token=${encodeURIComponent(token.token)}`);
    } catch {
      this.set({ state: "error", error: MESSAGES.connect });
      return;
    }
    this.socket = socket;
    this.sentEndOfStream = false;
    socket.onopen = () => {
      socket.send(JSON.stringify({ setup: token.setup }));
      this.setupTimer = this.setTimer(() => {
        if (!this.ready && this.socket === socket) {
          this.socket = null;
          socket.close(1000, "setup timeout");
          this.set({ state: "error", error: MESSAGES.connect });
        }
      }, SETUP_TIMEOUT_MS);
    };
    socket.onmessage = (ev) => {
      // Binary frames are read asynchronously; the chain keeps messages in order.
      this.inbox = this.inbox.then(async () => {
        const text = await frameText(ev.data);
        if (text && this.socket === socket) this.handle_(JSON.parse(text) as ServerMessage, socket, token, resumeHandle !== null);
      }).catch(() => undefined);
    };
    socket.onerror = () => undefined;
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (this.setupTimer) this.clearTimer(this.setupTimer);
      if (this.stopped) return;
      this.closeOpenLines();
      if (!this.everReady) {
        this.set({ state: "error", error: ev.code === 1008 || ev.code === 1007 ? MESSAGES.refused : MESSAGES.connect });
        return;
      }
      if (this.reconnects < MAX_RECONNECTS && ev.code !== 1008 && ev.code !== 1007) {
        this.reconnects++;
        this.set({ state: "reconnecting" });
        void this.connect(this.handle);
        return;
      }
      this.set({ state: "disconnected", error: ev.code === 1008 || ev.code === 1007 ? MESSAGES.refused : MESSAGES.lost });
    };
  }

  private handle_(msg: ServerMessage, socket: SocketLike, token: LiveTokenResponse, resumed: boolean) {
    if (msg.setupComplete !== undefined) {
      this.ready = true;
      this.everReady = true;
      this.reconnects = 0;
      if (this.setupTimer) this.clearTimer(this.setupTimer);
      this.set({ state: "thinking", error: null });
      // A fixed opening line (never the agent's words) so the assistant greets and asks first.
      if (!resumed || !this.handle) socket.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: token.kickoff }] }], turnComplete: true } }));
      return;
    }
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) this.handle = msg.sessionResumptionUpdate.newHandle;
    if (msg.goAway) {
      // Google is about to close this connection: move to a new one now, resuming the same conversation.
      this.reconnectSoon(socket);
      return;
    }
    if (msg.toolCallCancellation?.ids) for (const id of msg.toolCallCancellation.ids) this.cancelled.add(id);
    if (msg.toolCall?.functionCalls?.length) {
      this.set({ state: "thinking" });
      for (const call of msg.toolCall.functionCalls) void this.answerTool(call, socket);
    }
    const c = msg.serverContent;
    if (!c) return;
    if (c.inputTranscription?.text) {
      this.append("agent", c.inputTranscription.text);
      if (this.view.state !== "speaking") this.set({ state: "user_speaking" });
    }
    if (c.outputTranscription?.text) {
      this.closeOpenLine("agent");
      this.append("assistant", c.outputTranscription.text);
    }
    for (const part of c.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && (part.inlineData.mimeType ?? "audio/pcm").startsWith("audio/")) {
        this.closeOpenLine("agent");
        this.deps.audio.play(part.inlineData.data);
        if (this.view.state !== "speaking") this.set({ state: "speaking" });
      }
    }
    if (c.interrupted) {
      // The agent spoke over the assistant: stop its voice at once and listen.
      this.deps.audio.flush();
      this.closeOpenLine("assistant", true);
      this.set({ state: "listening" });
    }
    if (c.turnComplete) {
      this.closeOpenLine("assistant");
      if (!this.deps.audio.playing() && this.view.state !== "listening") this.set({ state: "waiting" });
      this.scheduleFlush();
    }
  }

  private reconnectSoon(old: SocketLike) {
    if (this.stopped) return;
    this.socket = null;
    this.set({ state: "reconnecting" });
    old.close(1000, "go away");
    void this.connect(this.handle);
  }

  private append(role: LiveLine["role"], text: string) {
    const lines = [...this.view.lines];
    const last = lines[lines.length - 1];
    if (last && last.role === role && !last.final) lines[lines.length - 1] = { ...last, text: joinWords(last.text, text) };
    else lines.push({ id: this.nextId++, role, text: text.trim(), final: false });
    this.set({ lines: lines.slice(-60) });
  }

  private closeOpenLine(role: LiveLine["role"], interrupted = false) {
    const lines = this.view.lines;
    const i = lines.length - 1;
    const last = lines[i];
    if (!last || last.role !== role || last.final) return;
    const next = [...lines];
    next[i] = { ...last, final: true, ...(interrupted ? { interrupted: true } : {}) };
    this.set({ lines: next });
  }

  private closeOpenLines() {
    if (this.view.lines.some((l) => !l.final)) this.set({ lines: this.view.lines.map((l) => (l.final ? l : { ...l, final: true })) });
  }

  /** Final lines not yet sent to the server. */
  private takeUnsynced(includeOpenAgent = false): { ids: number[]; lines: Array<{ role: "agent" | "assistant"; text: string }> } {
    const ids: number[] = [];
    const lines: Array<{ role: "agent" | "assistant"; text: string }> = [];
    for (const l of this.view.lines) {
      const open = !l.final && !(includeOpenAgent && l.role === "agent");
      if (open || this.synced.has(l.id) || !l.text.trim()) continue;
      this.synced.add(l.id);
      ids.push(l.id);
      lines.push({ role: l.role, text: l.interrupted ? `${l.text} …` : l.text });
    }
    return { ids, lines };
  }

  /** A save that failed: its lines go out again with the next one. */
  private unsync(ids: number[]) {
    for (const id of ids) this.synced.delete(id);
  }

  private scheduleFlush() {
    if (this.flushTimer) this.clearTimer(this.flushTimer);
    this.flushTimer = this.setTimer(() => void this.flush(), TRANSCRIPT_FLUSH_MS);
  }

  /** Saves the transcript lines that are complete. Serialised with tool updates, so revisions never cross. */
  flush(): Promise<unknown> {
    this.queue = this.queue.then(async () => {
      const { ids, lines } = this.takeUnsynced();
      if (!lines.length) return;
      try {
        const out = await this.deps.sync({ lines });
        this.deps.onSession(out.session);
      } catch {
        // Not worth interrupting the conversation for: the lines go out with the next save.
        this.unsync(ids);
      }
    });
    return this.queue;
  }

  private async answerTool(call: { id?: string; name?: string; args?: Record<string, unknown> }, socket: SocketLike) {
    const id = call.id ?? "";
    const name = call.name ?? "";
    let response: Record<string, unknown>;
    if (name !== LIVE_TOOL) {
      response = { error: "Unknown tool. Only record_property_facts exists." };
    } else {
      await new Promise<void>((resolve) => this.setTimer(resolve, TRANSCRIPT_SETTLE_MS));
      response = await (this.queue = this.queue.then(async () => {
        this.closeOpenLine("agent");
        // The agent's words the facts came from go with them (the server checks the evidence against them).
        const { ids, lines } = this.takeUnsynced(true);
        try {
          const out = await this.deps.sync({ lines, facts: call.args ?? {} });
          this.deps.onSession(out.session);
          if (out.result) {
            this.set({ last: out.result, reviewSuggested: out.result.next.action === "review" });
            if (out.result.recorded.length) this.deps.onRecorded?.(out.result.recorded.map((r) => r.field));
          }
          return { ...(out.result ?? {}) } as Record<string, unknown>;
        } catch (error) {
          // Nothing was saved: the model is told so, and asks the agent again rather than claiming success.
          this.unsync(ids);
          this.set({ error: MESSAGES.syncFailed });
          const reason = error instanceof Error && error.message ? error.message : "save failed";
          return { error: "NOT SAVED. Nothing from this update was recorded. Tell the agent briefly and ask them to repeat it, or to type it in the form.", reason };
        }
      })) as Record<string, unknown>;
    }
    if (this.cancelled.has(id) || this.socket !== socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify({ toolResponse: { functionResponses: [{ id, name, response }] } }));
  }

  private onMic(chunk: string, _level: number) {
    const socket = this.socket;
    if (!socket || !this.ready || socket.readyState !== OPEN) return;
    if (this.view.muted) return;
    socket.send(JSON.stringify({ realtimeInput: { audio: { data: chunk, mimeType: "audio/pcm;rate=16000" } } }));
  }

  /** Typed text inside the conversation (a noisy street, a name to spell). */
  sendText(text: string): boolean {
    const t = text.trim();
    const socket = this.socket;
    if (!t || !socket || !this.ready || socket.readyState !== OPEN) return false;
    this.closeOpenLines();
    this.append("agent", t);
    this.closeOpenLine("agent");
    socket.send(JSON.stringify({ realtimeInput: { text: t } }));
    this.set({ state: "thinking" });
    return true;
  }

  setMuted(muted: boolean) {
    this.set({ muted });
    const socket = this.socket;
    if (muted && socket && this.ready && socket.readyState === OPEN && !this.sentEndOfStream) {
      // Tells the service the microphone is paused, so it does not wait for the end of a sentence.
      socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      this.sentEndOfStream = true;
    }
    if (!muted) this.sentEndOfStream = false;
  }

  /** Ends the conversation: saves the last lines, closes the connection, releases the microphone. */
  async stop(): Promise<void> {
    if (this.stopped && this.view.state === "ended") return;
    this.stopped = true;
    if (this.flushTimer) this.clearTimer(this.flushTimer);
    if (this.setupTimer) this.clearTimer(this.setupTimer);
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    try {
      socket?.close(1000, "ended by agent");
    } catch {
      // already closed
    }
    this.deps.audio.flush();
    this.deps.audio.stop();
    this.closeOpenLines();
    this.set({ state: "ended" });
    await this.flush();
  }
}

/** Transcription arrives in pieces; join them with single spaces, without doubling the space a piece brings. */
export function joinWords(a: string, b: string): string {
  if (!a) return b.trim();
  if (!b) return a;
  const glue = /\s$/.test(a) || /^[\s,.;:!?·…)]/.test(b) ? "" : " ";
  return `${a}${glue}${b}`.replace(/\s+/g, " ").trimStart();
}
