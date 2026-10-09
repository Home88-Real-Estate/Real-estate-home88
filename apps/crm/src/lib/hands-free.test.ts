import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVad, DEFAULT_VAD, rmsDb, type VadConfig, type VadEvent } from "./hands-free";

/** Feeds `levels` (dB), one reading every `step` ms, and returns the events with the time they fired. */
function run(levels: number[], step = 50, config: VadConfig = DEFAULT_VAD) {
  const vad = createVad(config);
  const events: Array<[VadEvent, number]> = [];
  levels.forEach((level, i) => {
    const e = vad.push(level, i * step);
    if (e) events.push([e, i * step]);
  });
  return events;
}
const repeat = (db: number, ms: number, step = 50) => Array.from({ length: Math.round(ms / step) }, () => db);

describe("measuring level", () => {
  it("is -100 for silence and about -6 dBFS for a half-scale tone", () => {
    assert.equal(rmsDb(new Float32Array(512)), -100);
    assert.equal(rmsDb([]), -100);
    const tone = Float32Array.from({ length: 1024 }, (_, i) => 0.5 * Math.sin((i / 1024) * 2 * Math.PI * 16) * Math.SQRT2);
    assert.ok(Math.abs(rmsDb(tone) - -6.02) < 0.2, `got ${rmsDb(tone)}`);
  });
});

describe("hearing a turn", () => {
  const room = -62;
  const voice = -28;

  it("starts on sustained speech and ends after a pause", () => {
    const events = run([...repeat(room, 500), ...repeat(voice, 1200), ...repeat(room, 2000)]);
    assert.deepEqual(events.map((e) => e[0]), ["speech_start", "speech_end"]);
    assert.ok(events[0]![1] >= 500 + 300 - 50, "waits for minSpeechMs before calling it speech");
    assert.ok(events[1]![1] >= 500 + 1200 + 1500 - 50, "waits for endSilenceMs before ending the turn");
  });

  it("does not end the turn on a short pause between words", () => {
    const events = run([...repeat(room, 500), ...repeat(voice, 800), ...repeat(room, 700), ...repeat(voice, 800), ...repeat(room, 2000)]);
    assert.deepEqual(events.map((e) => e[0]), ["speech_start", "speech_end"], "one turn, not two");
  });

  it("ignores a click or cough shorter than the minimum", () => {
    const events = run([...repeat(room, 600), ...repeat(voice, 150), ...repeat(room, 3000)]);
    assert.deepEqual(events, []);
  });

  it("adapts to a noisy room: steady background noise is not speech", () => {
    const noisy = -38; // a street, a car
    const events = run([...repeat(noisy, 6000)]);
    assert.deepEqual(events, [], "constant noise never counts as speech");
    const spoken = run([...repeat(noisy, 600), ...repeat(-20, 800), ...repeat(noisy, 2200)]);
    assert.deepEqual(spoken.map((e) => e[0]), ["speech_start", "speech_end"], "speaking clearly over it does");
  });

  it("gives up waiting after a long silence, once", () => {
    const events = run(repeat(room, 20_000));
    assert.deepEqual(events.map((e) => e[0]), ["no_speech"]);
    assert.ok(events[0]![1] >= DEFAULT_VAD.noSpeechMs - 50 && events[0]![1] < DEFAULT_VAD.noSpeechMs + 100);
  });

  it("cuts a turn that never stops", () => {
    const events = run([...repeat(room, 500), ...repeat(voice, 70_000)]);
    assert.deepEqual(events.map((e) => e[0]), ["speech_start", "too_long"]);
  });

  it("never reports anything after the turn is over", () => {
    const vad = createVad();
    const seen: VadEvent[] = [];
    [...repeat(room, 500), ...repeat(voice, 600), ...repeat(room, 2500), ...repeat(voice, 2000)].forEach((l, i) => {
      const e = vad.push(l, i * 50);
      if (e) seen.push(e);
    });
    assert.deepEqual(seen, ["speech_start", "speech_end"]);
  });

  it("treats very quiet sound as silence even in a silent room", () => {
    assert.deepEqual(run([...repeat(-90, 600), ...repeat(-55, 3000)]), [], "below the floor is never speech");
  });
});
