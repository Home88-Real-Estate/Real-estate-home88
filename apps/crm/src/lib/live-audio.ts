"use client";

/**
 * Microphone and speaker for the live conversation (browser only).
 *
 * Capture: the browser's echo cancellation, noise suppression and gain control are on, and while the assistant
 * is speaking quiet input is replaced by silence (see gateEcho), so the assistant does not hear itself through
 * the speaker. Audio is converted to 16 kHz PCM in memory and streamed; nothing is recorded or stored.
 * Playback: 24 kHz chunks are scheduled back to back; an interruption stops them at once.
 */

import { CRM_BASE_PATH } from "./paths";
import { base64PcmToFloat, Chunker, floatToInt16, gateEcho, int16ToBase64, OUTPUT_RATE, Resampler, rms } from "./live-pcm";
import type { LiveAudioPort } from "./live-session";

type Ctx = AudioContext;
const AudioCtx = (): typeof AudioContext | undefined =>
  typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

export function liveAudioSupported(): boolean {
  return typeof window !== "undefined" && typeof WebSocket !== "undefined" && Boolean(AudioCtx()) && Boolean(navigator.mediaDevices?.getUserMedia);
}

export class BrowserLiveAudio implements LiveAudioPort {
  private input: Ctx | null = null;
  private output: Ctx | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private idle: () => void = () => undefined;
  /** The live microphone stream, for the level meter on screen (read locally, never sent elsewhere). */
  onStream: (stream: MediaStream | null) => void = () => undefined;

  unlock(): void {
    const Ctor = AudioCtx();
    if (!Ctor) return;
    // Created inside the tap: iOS and Android only let a page make sound from a user gesture.
    if (!this.output || this.output.state === "closed") {
      try {
        this.output = new Ctor({ sampleRate: OUTPUT_RATE, latencyHint: "interactive" });
      } catch {
        this.output = new Ctor({ latencyHint: "interactive" });
      }
    }
    void this.output.resume().catch(() => undefined);
    if (!this.input || this.input.state === "closed") this.input = new Ctor({ latencyHint: "interactive" });
    void this.input.resume().catch(() => undefined);
  }

  async start(onChunk: (base64: string, level: number) => void): Promise<void> {
    const Ctor = AudioCtx();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
    if (!this.input || this.input.state === "closed") this.unlock();
    const ctx = this.input!;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.onStream(this.stream);
    const source = ctx.createMediaStreamSource(this.stream);
    const resampler = new Resampler(ctx.sampleRate);
    const chunker = new Chunker();
    const handle = (samples: Float32Array) => {
      for (const chunk of chunker.push(resampler.push(samples))) {
        const gated = gateEcho(chunk, this.playing());
        onChunk(int16ToBase64(floatToInt16(gated)), rms(chunk));
      }
    };
    // Not audible: the tap must be connected for the browser to run it, so it goes through a muted gain.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    let tap: AudioNode;
    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(`${CRM_BASE_PATH}/live-capture-worklet.js`);
      const node = new AudioWorkletNode(ctx, "home88-pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => handle(e.data);
      tap = node;
    } else {
      // Older Safari: the deprecated processor still works where AudioWorklet does not.
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
      tap = node;
    }
    source.connect(tap);
    tap.connect(mute);
    this.nodes = [source, tap, mute];
  }

  stop(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.nodes = [];
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.onStream(null);
    void this.input?.close().catch(() => undefined);
    this.input = null;
  }

  play(base64: string): void {
    const ctx = this.output;
    if (!ctx) return;
    const samples = base64PcmToFloat(base64);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.nextTime);
    source.start(at);
    this.nextTime = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.idle();
    };
  }

  flush(): void {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // not started yet
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  playing(): boolean {
    return this.sources.size > 0;
  }

  onIdle(cb: () => void): void {
    this.idle = cb;
  }

  /** Releases the speaker too (when the page goes away). */
  close(): void {
    this.stop();
    this.flush();
    void this.output?.close().catch(() => undefined);
    this.output = null;
  }
}
