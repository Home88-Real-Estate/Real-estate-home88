/**
 * Hands-free listening: work out, from the microphone level alone, when the
 * agent starts and stops speaking, so a conversation needs no button per turn.
 *
 * Nothing leaves the device here. The level is read locally and discarded; a
 * recording is only made, and only sent for transcription, once speech has been
 * heard. The decision logic is a pure state machine so it is unit-tested with
 * made-up levels; the browser glue below only feeds it.
 */

export type VadConfig = {
  /** Never treat anything below this as speech, however quiet the room (dBFS). */
  floorDb: number;
  /** Speech must be this far above the room's own background noise (dB). */
  marginDb: number;
  /** How long the first moments are used to measure the background noise. */
  calibrationMs: number;
  /** Sound shorter than this (a click, a cough) is not speech. */
  minSpeechMs: number;
  /** This much quiet after speech ends the turn. */
  endSilenceMs: number;
  /** Nothing said for this long: stop waiting. */
  noSpeechMs: number;
  /** A single turn longer than this is cut. */
  maxUtteranceMs: number;
};

export const DEFAULT_VAD: VadConfig = {
  floorDb: -48,
  marginDb: 12,
  calibrationMs: 400,
  minSpeechMs: 300,
  endSilenceMs: 1500,
  noSpeechMs: 15_000,
  maxUtteranceMs: 55_000,
};

export type VadEvent = "speech_start" | "speech_end" | "no_speech" | "too_long";

/** Root-mean-square level of float samples in [-1, 1], in dBFS. Silence is -Infinity-safe (-100). */
export function rmsDb(samples: ArrayLike<number>): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += (samples[i] ?? 0) ** 2;
  const rms = Math.sqrt(sum / samples.length);
  return rms < 1e-5 ? -100 : 20 * Math.log10(rms);
}

export function createVad(config: VadConfig = DEFAULT_VAD) {
  let startedAt: number | null = null;
  let calibration: number[] = [];
  let noiseDb: number | null = null;
  let loudSince: number | null = null;
  let speechStartedAt: number | null = null;
  let quietSince: number | null = null;
  let finished = false;

  const threshold = () => Math.max(config.floorDb, (noiseDb ?? config.floorDb) + config.marginDb);

  return {
    /** Feed one reading; returns an event when something worth acting on has happened. Terminal events are returned once. */
    push(levelDb: number, nowMs: number): VadEvent | null {
      if (finished) return null;
      startedAt ??= nowMs;
      const elapsed = nowMs - startedAt;

      if (noiseDb === null) {
        calibration.push(levelDb);
        if (elapsed >= config.calibrationMs) {
          // The median ignores a word spoken right at the start.
          const sorted = [...calibration].sort((a, b) => a - b);
          noiseDb = sorted[Math.floor(sorted.length / 2)] ?? config.floorDb;
          calibration = [];
        }
        // Speech during calibration still counts when it is clearly above the floor.
        if (noiseDb === null && levelDb < config.floorDb + config.marginDb) return null;
      }

      const loud = levelDb > threshold();
      if (speechStartedAt === null) {
        if (loud) {
          loudSince ??= nowMs;
          if (nowMs - loudSince >= config.minSpeechMs) {
            speechStartedAt = loudSince;
            quietSince = null;
            return "speech_start";
          }
        } else {
          loudSince = null;
        }
        if (elapsed >= config.noSpeechMs) {
          finished = true;
          return "no_speech";
        }
        return null;
      }

      if (nowMs - speechStartedAt >= config.maxUtteranceMs) {
        finished = true;
        return "too_long";
      }
      if (loud) {
        quietSince = null;
        return null;
      }
      quietSince ??= nowMs;
      if (nowMs - quietSince >= config.endSilenceMs) {
        finished = true;
        return "speech_end";
      }
      return null;
    },
  };
}

export type Listener = { stop(): void };

/**
 * Reads the microphone level every 50 ms and reports the VAD's events. Returns a
 * handle to stop it. Works in any browser with Web Audio; if an AudioContext cannot be made it throws,
 * and the caller falls back to the tap-to-talk button.
 */
export function listenForSpeech(stream: MediaStream, onEvent: (event: VadEvent) => void, config: VadConfig = DEFAULT_VAD): Listener {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("no-audio-context");
  const context = new Ctx();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const vad = createVad(config);
  let stopped = false;
  void context.resume().catch(() => undefined);
  const timer = setInterval(() => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buffer);
    const event = vad.push(rmsDb(buffer), performance.now());
    if (event) onEvent(event);
  }, 50);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      void context.close().catch(() => undefined);
    },
  };
}
