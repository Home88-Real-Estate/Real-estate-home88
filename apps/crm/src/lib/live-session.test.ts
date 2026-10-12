/**
 * The live conversation, driven by scripted Live API messages through a fake socket, fake audio and a fake API.
 * No network, no microphone, no paid calls: these are simulations of the protocol, not tests against Google.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IntakeSession } from "./intake-client";
import { base64PcmToFloat, Chunker, floatToInt16, gateEcho, int16ToBase64, Resampler, rms } from "./live-pcm";
import { frameText, joinWords, LIVE_TOOL, LiveConversation, micErrorMessage, type LiveDeps, type LiveToolResult, type LiveView, type SocketLike } from "./live-session";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string; wasClean?: boolean }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  /** A server message, as text or (like the real API) as a binary frame. */
  async receive(msg: object, binary = false) {
    const text = JSON.stringify(msg);
    this.onmessage?.({ data: binary ? new Blob([text]) : text });
    await tick();
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  of(kind: string) {
    return this.sent.filter((m) => kind in m);
  }
}

class FakeAudio {
  chunkSink: ((b64: string, level: number) => void) | null = null;
  played: string[] = [];
  flushed = 0;
  stopped = 0;
  unlocked = 0;
  isPlaying = false;
  idle: () => void = () => undefined;
  startError: unknown = null;
  unlock() { this.unlocked++; }
  async start(onChunk: (b64: string, level: number) => void) {
    if (this.startError) throw this.startError;
    this.chunkSink = onChunk;
  }
  stop() { this.stopped++; this.chunkSink = null; }
  play(b64: string) { this.played.push(b64); this.isPlaying = true; }
  flush() { this.flushed++; this.isPlaying = false; }
  playing() { return this.isPlaying; }
  onIdle(cb: () => void) { this.idle = cb; }
  finishPlaying() { this.isPlaying = false; this.idle(); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const session = (revision: number, fields: Record<string, unknown> = {}) => ({ id: "s1", revision, fields } as unknown as IntakeSession);
const result = (over: Partial<LiveToolResult> = {}): LiveToolResult => ({
  recorded: [], toConfirm: [], rejected: [], notes: [], next: { action: "ask", field: "price", label: "Τιμή", question: "Ποια είναι η ζητούμενη τιμή;" }, suggestedReply: "", ...over,
});

function setup(options: { tokenError?: Error; syncImpl?: LiveDeps["sync"]; manualTimers?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const audio = new FakeAudio();
  const views: LiveView[] = [];
  const tokens: Array<string | undefined> = [];
  const syncs: Array<{ lines: Array<{ role: string; text: string }>; facts?: Record<string, unknown> }> = [];
  const sessions: IntakeSession[] = [];
  const recorded: string[][] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  let revision = 1;
  const deps: LiveDeps = {
    async token(handle) {
      tokens.push(handle);
      if (options.tokenError) throw options.tokenError;
      return { token: "auth_tokens/t1", url: "wss://generativelanguage.googleapis.com/ws/x.BidiGenerateContentConstrained", model: "gemini-3.8-live", setup: { model: "models/gemini-3.8-live" }, kickoff: "[start]", expiresAt: "", audio: { inputSampleRate: 16000, outputSampleRate: 24000, inputMimeType: "audio/pcm;rate=16000" } };
    },
    sync: options.syncImpl ?? (async (body) => {
      syncs.push(body);
      return { session: session(++revision), result: body.facts ? result() : null };
    }),
    openSocket(url) {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    audio,
    onChange: (v) => views.push(v),
    onSession: (s) => sessions.push(s),
    onRecorded: (k) => recorded.push(k),
    ...(options.manualTimers
      ? {
          setTimer: (fn: () => void, ms: number) => {
            const t = { fn, ms, cleared: false };
            timers.push(t);
            if (ms <= 400) setTimeout(() => !t.cleared && fn(), 0);
            return t;
          },
          clearTimer: (t: unknown) => { (t as { cleared: boolean }).cleared = true; },
        }
      : {}),
  };
  if (options.syncImpl) {
    const inner = options.syncImpl;
    deps.sync = async (body) => {
      syncs.push(body);
      return inner(body);
    };
  }
  const live = new LiveConversation(deps);
  const state = () => live.snapshot.state;
  return { live, sockets, audio, views, tokens, syncs, sessions, recorded, timers, state, sock: () => sockets[sockets.length - 1]! };
}

async function connected(t: ReturnType<typeof setup>) {
  const started = t.live.start();
  await until(() => t.sockets.length > 0);
  t.sock().open();
  await t.sock().receive({ setupComplete: {} });
  await started;
}

describe("PCM conversion", () => {
  it("resamples 48 kHz to 16 kHz without losing or inventing time across chunks", () => {
    const r = new Resampler(48_000);
    let total = 0;
    for (let i = 0; i < 10; i++) total += r.push(new Float32Array(4800).fill(0.5)).length;
    assert.equal(total, 16_000, "one second in, one second out");
    const r2 = new Resampler(44_100);
    let t2 = 0;
    for (let i = 0; i < 100; i++) t2 += r2.push(new Float32Array(441)).length;
    assert.ok(Math.abs(t2 - 16_000) <= 1, `44.1 kHz: ${t2}`);
    const same = new Resampler(16_000).push(Float32Array.from([0.1, 0.2]));
    assert.deepEqual(Array.from(same).map((x) => x.toFixed(1)), ["0.1", "0.2"]);
  });

  it("encodes 16-bit little-endian PCM and decodes the 24 kHz answer", () => {
    const pcm = floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
    assert.deepEqual(Array.from(pcm), [0, 32767, -32768, 32767, -32768, 16384]);
    const b64 = int16ToBase64(Int16Array.from([1, -2, 256]));
    assert.deepEqual([...Buffer.from(b64, "base64")], [1, 0, 0xfe, 0xff, 0, 1]);
    const back = base64PcmToFloat(int16ToBase64(Int16Array.from([16384, -16384])));
    assert.deepEqual(Array.from(back), [0.5, -0.5]);
  });

  it("chunks into 100 ms pieces and keeps the remainder", () => {
    const c = new Chunker(1600);
    assert.equal(c.push(new Float32Array(1000)).length, 0);
    const out = c.push(new Float32Array(2500));
    assert.equal(out.length, 2);
    assert.equal(c.drain()!.length, 300);
    assert.equal(c.drain(), null);
  });

  it("silences quiet input only while the assistant speaks (echo), never the agent's own speech", () => {
    const echo = new Float32Array(100).fill(0.01);
    const speech = new Float32Array(100).fill(0.3);
    assert.equal(rms(gateEcho(echo, true)), 0);
    assert.ok(rms(gateEcho(speech, true)) > 0.2, "speaking over the assistant still interrupts it");
    assert.ok(rms(gateEcho(echo, false)) > 0, "nothing is gated while the assistant is quiet");
  });
});

describe("live conversation", () => {
  it("connects with the token, sends the locked setup, greets first and streams the microphone only when ready", async () => {
    const t = setup();
    const started = t.live.start();
    assert.equal(t.audio.unlocked, 1, "speaker unlocked inside the tap");
    await until(() => t.sockets.length > 0);
    assert.match(t.sock().url, /BidiGenerateContentConstrained\?access_token=auth_tokens%2Ft1$/);
    t.audio.chunkSink!("early", 0.2);
    t.sock().open();
    assert.deepEqual(t.sock().sent[0], { setup: { model: "models/gemini-3.8-live" } });
    assert.equal(t.sock().of("realtimeInput").length, 0, "no audio before the setup is confirmed");
    await t.sock().receive({ setupComplete: {} }, true);
    await started;
    assert.deepEqual(t.sock().of("clientContent")[0].clientContent.turns[0].parts[0].text, "[start]");
    t.audio.chunkSink!("AAAA", 0.2);
    assert.deepEqual(t.sock().of("realtimeInput").at(-1), { realtimeInput: { audio: { data: "AAAA", mimeType: "audio/pcm;rate=16000" } } });
    assert.equal(t.state(), "thinking");
  });

  it("holds a Greek conversation over several turns: speaks, listens, records validated facts, asks one next question", async () => {
    const answers = [
      result({ recorded: [{ field: "listingType", label: "Είδος αγγελίας", value: "Πώληση" }, { field: "propertyType", label: "Τύπος ακινήτου", value: "Διαμέρισμα" }, { field: "areaName", label: "Περιοχή", value: "Γλυφάδα" }], next: { action: "ask", field: "price", label: "Τιμή", question: "Ποια είναι η ζητούμενη τιμή;" } }),
      result({ recorded: [{ field: "area", label: "Εμβαδόν", value: "85 τ.μ." }, { field: "price", label: "Τιμή", value: "€320.000" }], next: { action: "ask", field: "bedrooms", label: "Υπνοδωμάτια", question: "Πόσα υπνοδωμάτια έχει;" } }),
    ];
    let n = 0;
    const t = setup({ syncImpl: async (body) => ({ session: session(10 + n, { price: 1 }), result: body.facts ? answers[n++]! : null }) });
    await connected(t);
    // The assistant greets (audio + its words as text).
    await t.sock().receive({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "Γεια σας! Θα σας βοηθήσω" } } });
    assert.equal(t.state(), "speaking");
    await t.sock().receive({ serverContent: { outputTranscription: { text: " να καταχωρίσουμε το ακίνητο." }, turnComplete: true } });
    t.audio.finishPlaying();
    assert.equal(t.state(), "waiting");
    // The agent answers, in pieces.
    await t.sock().receive({ serverContent: { inputTranscription: { text: "Έχω ένα διαμέρισμα στη Γλυφάδα" } } });
    assert.equal(t.state(), "user_speaking");
    await t.sock().receive({ serverContent: { inputTranscription: { text: " για πώληση." } } });
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c1", name: LIVE_TOOL, args: { proposals: [{ key: "propertyType", value: "APARTMENT", evidence: "διαμέρισμα" }] } }] } });
    assert.equal(t.state(), "thinking");
    await until(() => t.sock().of("toolResponse").length === 1);
    const first = t.syncs.find((s) => s.facts)!;
    assert.deepEqual(first.lines.filter((l) => l.role === "agent").map((l) => l.text), ["Έχω ένα διαμέρισμα στη Γλυφάδα για πώληση."], "the agent's own words travel with the facts, as evidence");
    assert.deepEqual(first.facts, { proposals: [{ key: "propertyType", value: "APARTMENT", evidence: "διαμέρισμα" }] }, "forwarded untouched: the server validates");
    const response = t.sock().of("toolResponse")[0].toolResponse.functionResponses[0];
    assert.equal(response.id, "c1");
    assert.equal(response.name, LIVE_TOOL);
    assert.equal(response.response.next.question, "Ποια είναι η ζητούμενη τιμή;", "one question at a time, chosen by HOME88's flow");
    assert.deepEqual(t.recorded[0], ["listingType", "propertyType", "areaName"]);
    assert.equal(t.sessions.length, 1, "the summary updates from the server's validated session");
    // Second turn.
    await t.sock().receive({ serverContent: { outputTranscription: { text: "Ωραία. Ποια είναι η ζητούμενη τιμή;" }, turnComplete: true } });
    await t.sock().receive({ serverContent: { inputTranscription: { text: "85 τετραγωνικά, 320.000 ευρώ." } } });
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c2", name: LIVE_TOOL, args: { proposals: [] } }] } });
    await until(() => t.sock().of("toolResponse").length === 2);
    assert.equal(t.live.snapshot.last!.recorded.length, 2);
    assert.deepEqual(t.live.snapshot.lines.map((l) => l.role), ["assistant", "agent", "assistant", "agent"]);
  });

  it("follows English and passes corrections and yes/no answers through to the server", async () => {
    const t = setup();
    await connected(t);
    await t.sock().receive({ serverContent: { inputTranscription: { text: "Actually, make that three bedrooms." } } });
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c1", name: LIVE_TOOL, args: { language: "en", proposals: [{ key: "bedrooms", value: "3", evidence: "three bedrooms", isCorrection: true }] } }] } });
    await t.sock().receive({ serverContent: { inputTranscription: { text: "Yes." } } });
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c2", name: LIVE_TOOL, args: { proposals: [], commands: [{ type: "accept" }] } }] } });
    await until(() => t.sock().of("toolResponse").length === 2);
    const facts = t.syncs.filter((s) => s.facts).map((s) => s.facts);
    assert.equal((facts[0] as any).proposals[0].isCorrection, true);
    assert.deepEqual((facts[1] as any).commands, [{ type: "accept" }]);
  });

  it("shows held values as questions, not as recorded", async () => {
    const t = setup({ syncImpl: async () => ({ session: session(3), result: result({ toConfirm: [{ field: "floor", label: "Όροφος", proposed: "3", current: null, question: "Όροφος: 3. Σωστό;" }], next: { action: "confirm", field: "floor", question: "Όροφος: 3. Σωστό;" } }) }) });
    await connected(t);
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c1", name: LIVE_TOOL, args: { proposals: [{ key: "floor", value: "3", evidence: "τρίτος" }] } }] } });
    await until(() => t.sock().of("toolResponse").length === 1);
    assert.equal(t.recorded.length, 0, "nothing is highlighted as recorded");
    assert.equal(t.live.snapshot.last!.toConfirm[0]!.field, "floor");
  });

  it("stops the assistant's voice at once when the agent interrupts", async () => {
    const t = setup();
    await connected(t);
    await t.sock().receive({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "Η τιμή που είπατε" } } });
    assert.equal(t.state(), "speaking");
    await t.sock().receive({ serverContent: { interrupted: true } });
    assert.equal(t.audio.flushed, 1);
    assert.equal(t.state(), "listening");
    const line = t.live.snapshot.lines.at(-1)!;
    assert.equal(line.interrupted, true);
    await t.live.flush();
    assert.equal(t.syncs.at(-1)!.lines.at(-1)!.text, "Η τιμή που είπατε …", "an interrupted reply is saved as cut off");
  });

  it("does not spend a token when the microphone is refused, and says how to allow it", async () => {
    const t = setup();
    t.audio.startError = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    await t.live.start();
    assert.equal(t.state(), "error");
    assert.match(t.live.snapshot.error!, /άδεια για το μικρόφωνο/);
    assert.equal(t.tokens.length, 0);
    assert.match(micErrorMessage({ name: "NotFoundError" }), /Δεν βρέθηκε μικρόφωνο/);
  });

  it("shows the server's own message when a token is refused (key, quota, not configured)", async () => {
    const t = setup({ tokenError: new Error("Η υπηρεσία AI έχει πολλά αιτήματα αυτή τη στιγμή.") });
    await t.live.start();
    assert.equal(t.state(), "error");
    assert.match(t.live.snapshot.error!, /πολλά αιτήματα/);
    assert.equal(t.audio.stopped, 0, "the microphone is released only when the agent ends or leaves");
  });

  it("gives up on a connection that never completes its setup (timeout), without leaking the provider's reason", async () => {
    const t = setup({ manualTimers: true });
    const started = t.live.start();
    await until(() => t.sockets.length > 0);
    t.sock().open();
    await started;
    const setupTimer = t.timers.find((x) => x.ms === 15_000)!;
    assert.ok(setupTimer, "a setup timeout is armed");
    setupTimer.fn();
    assert.equal(t.state(), "error");
    assert.match(t.live.snapshot.error!, /Δεν ήταν δυνατή η σύνδεση/);
    const t2 = setup();
    const s2 = t2.live.start();
    await until(() => t2.sockets.length > 0);
    t2.sock().open();
    t2.sock().onclose?.({ code: 1008, reason: "API key not valid. Please pass a valid API key." });
    await s2;
    assert.equal(t2.state(), "error");
    assert.ok(!/API key/.test(t2.live.snapshot.error!), "the provider's words are never shown");
  });

  it("reconnects after a drop, resuming the same conversation, without a new draft or a second greeting", async () => {
    const t = setup();
    await connected(t);
    await t.sock().receive({ sessionResumptionUpdate: { newHandle: "h-42", resumable: true } });
    await t.sock().receive({ serverContent: { inputTranscription: { text: "Θέση στάθμευσης έχει." } } });
    t.sock().drop(1006);
    assert.equal(t.state(), "reconnecting");
    await until(() => t.sockets.length === 2);
    assert.deepEqual(t.tokens, [undefined, "h-42"], "the new token carries the resumption handle");
    t.sock().open();
    await t.sock().receive({ setupComplete: {} });
    assert.equal(t.sock().of("clientContent").length, 0, "a resumed conversation does not start over");
    // Google's own "going away" notice moves to a new connection before it closes.
    await t.sock().receive({ sessionResumptionUpdate: { newHandle: "h-43", resumable: true } });
    const old = t.sock();
    await t.sock().receive({ goAway: { timeLeft: "5s" } });
    assert.equal(old.closed?.code, 1000);
    await until(() => t.sockets.length === 3);
    assert.equal(t.tokens.at(-1), "h-43");
  });

  it("stops retrying after repeated drops, then reconnects on request", async () => {
    const t2 = setup();
    await connected(t2);
    t2.sock().drop();
    await until(() => t2.sockets.length === 2);
    t2.sock().drop();
    assert.equal(t2.state(), "error", "a reconnection that never completes setup is reported, not retried forever");
    await t2.live.retry();
    await until(() => t2.sockets.length === 3);
    t2.sock().open();
    await t2.sock().receive({ setupComplete: {} });
    assert.equal(t2.state(), "thinking");
  });

  it("tells the model when an update was NOT saved, shows it, and sends the words again with the next save", async () => {
    let fail = true;
    const t = setup({ syncImpl: async (body) => { if (fail) throw new Error("Δεν υπάρχει σύνδεση."); return { session: session(5), result: body.facts ? result() : null }; } });
    await connected(t);
    await t.sock().receive({ serverContent: { inputTranscription: { text: "Τιμή 300 χιλιάδες." } } });
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c1", name: LIVE_TOOL, args: { proposals: [{ key: "price", value: "300000", evidence: "300 χιλιάδες" }] } }] } });
    await until(() => t.sock().of("toolResponse").length === 1);
    const r = t.sock().of("toolResponse")[0].toolResponse.functionResponses[0].response;
    assert.match(r.error, /NOT SAVED/);
    assert.match(t.live.snapshot.error!, /Δεν αποθηκεύτηκαν/);
    fail = false;
    await t.live.flush();
    assert.equal(t.syncs.at(-1)!.lines[0]!.text, "Τιμή 300 χιλιάδες.", "the failed lines go out with the next save");
  });

  it("answers an unknown tool with an error, and skips cancelled calls", async () => {
    const t = setup();
    await connected(t);
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "x", name: "delete_everything", args: {} }] } });
    await until(() => t.sock().of("toolResponse").length === 1);
    assert.match(t.sock().of("toolResponse")[0].toolResponse.functionResponses[0].response.error, /Unknown tool/);
    assert.equal(t.syncs.length, 0, "nothing reaches the server");
    await t.sock().receive({ toolCall: { functionCalls: [{ id: "c9", name: LIVE_TOOL, args: { proposals: [] } }] } });
    await t.sock().receive({ toolCallCancellation: { ids: ["c9"] } });
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(t.sock().of("toolResponse").length, 1, "a cancelled call gets no answer");
  });

  it("mutes (telling the service the microphone paused), takes typed text, and ends cleanly saving the last words", async () => {
    const t = setup();
    await connected(t);
    t.live.setMuted(true);
    assert.deepEqual(t.sock().of("realtimeInput").at(-1), { realtimeInput: { audioStreamEnd: true } });
    const before = t.sock().sent.length;
    t.audio.chunkSink!("AAAA", 0.5);
    assert.equal(t.sock().sent.length, before, "no audio while muted");
    t.live.setMuted(false);
    assert.equal(t.live.sendText("  Οδός Ερμού 10  "), true);
    assert.deepEqual(t.sock().sent.at(-1), { realtimeInput: { text: "Οδός Ερμού 10" } });
    await t.sock().receive({ serverContent: { outputTranscription: { text: "Καταγράφηκε." } } });
    const sock = t.sock();
    await t.live.stop();
    assert.equal(sock.closed?.code, 1000);
    assert.equal(t.audio.stopped, 1);
    assert.equal(t.state(), "ended");
    assert.deepEqual(t.syncs.at(-1)!.lines.map((l) => l.text), ["Οδός Ερμού 10", "Καταγράφηκε."]);
    sock.drop();
    assert.equal(t.state(), "ended", "a close after ending is not a disconnection");
  });

  it("reads binary frames and joins transcription pieces cleanly", async () => {
    assert.equal(await frameText(new TextEncoder().encode('{"a":1}').buffer), '{"a":1}');
    assert.equal(await frameText(new Blob(['{"b":2}'])), '{"b":2}');
    assert.equal(await frameText(42), null);
    assert.equal(joinWords("Έχω ένα", " διαμέρισμα"), "Έχω ένα διαμέρισμα");
    assert.equal(joinWords("τρία", "υπνοδωμάτια"), "τρία υπνοδωμάτια");
    assert.equal(joinWords("τιμή", ", 300"), "τιμή, 300");
  });
});
