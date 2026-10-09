/**
 * Manual smoke test against the REAL Gemini API. Not part of `npm test`: it makes
 * a handful of paid calls (a few cents) and needs a key.
 *
 *   GEMINI_API_KEY=... npx tsx apps/api/src/lib/property-intake/smoke.ts [outputDir]
 *
 * It checks, in order: speech synthesis in Greek and English, transcription of
 * those same clips (a round trip, so no microphone is needed), and structured
 * extraction on the Greek transcript. The key is never printed. Each step
 * reports PASS/FAIL with the model used, so a wrong or retired model id shows
 * up immediately. WAV files are written so you can listen to them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createGeminiIntakeAi } from "./ai";
import { intakeAiConfig } from "./config";
import { extractionJsonSchema, extractionSystemPrompt, extractionUserPrompt, parseExtraction } from "./extraction";
import { allowedFields } from "./fields";
import { emptyState } from "./state";

const out = process.argv[2] ?? "intake-smoke-output";
const config = intakeAiConfig();
if (!config.apiKey) {
  console.error("No key: set GEMINI_API_KEY (or AI_Property_Intake) in the environment.");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const ai = createGeminiIntakeAi(config);
let failures = 0;
const step = async (name: string, model: string, run: () => Promise<string>) => {
  const started = Date.now();
  try {
    console.log(`PASS  ${name} [${model}] ${Date.now() - started} ms — ${await run()}`);
  } catch (error) {
    failures += 1;
    const category = (error as { category?: string }).category ?? "error";
    const status = ((error as { cause?: { status?: number } }).cause?.status) ?? "";
    console.log(`FAIL  ${name} [${model}] — ${category} ${status}`);
  }
};
const signal = () => AbortSignal.timeout(config.timeoutMs);

const GREEK = "Έχω ένα διαμέρισμα προς πώληση στη Γλυφάδα, εννιάντα πέντε τετραγωνικά, με δύο υπνοδωμάτια. Η τιμή είναι τετρακόσιες είκοσι χιλιάδες ευρώ.";
const ENGLISH = "The apartment is on the third floor and has a storage room.";
const clips: Record<string, Buffer> = {};

for (const [name, text, lang] of [["greek", GREEK, "el"], ["english", ENGLISH, "en"]] as const) {
  await step(`speak (${name})`, config.ttsModel, async () => {
    const r = await ai.speak({ text, lang }, signal());
    clips[name] = r.wav;
    writeFileSync(join(out, `${name}.wav`), r.wav);
    return `${(r.wav.length / 1024).toFixed(0)} KB written to ${join(out, `${name}.wav`)}`;
  });
}

const heard: Record<string, string> = {};
for (const name of ["greek", "english"] as const) {
  if (!clips[name]) continue;
  await step(`transcribe (${name})`, config.transcribeModel, async () => {
    const r = await ai.transcribe({ audio: clips[name]!, mimeType: "audio/wav", preference: "auto" }, signal());
    heard[name] = r.text;
    const ok = name === "greek" ? /Γλυφάδα|Γλυφαδα/i.test(r.text) : /third floor/i.test(r.text);
    if (!ok) throw new Error("transcript did not contain the expected words");
    return `language=${r.language ?? "?"}, ${r.text.length} characters`;
  });
}

await step("extract (greek transcript)", config.extractModel, async () => {
  const specs = allowedFields(undefined, undefined);
  const utterance = heard.greek ?? GREEK;
  const raw = await ai.extract(
    {
      system: extractionSystemPrompt(specs),
      user: extractionUserPrompt({ utterance, state: emptyState(), specs, expectedKey: null, history: [] }),
      schema: extractionJsonSchema(specs.map((s) => s.key)),
    },
    signal(),
  );
  const parsed = parseExtraction(raw, new Set(specs.map((s) => s.key)));
  const keys = parsed.proposals.map((p) => `${p.key}=${p.value}`);
  const price = parsed.proposals.find((p) => p.key === "price");
  if (!price || Number(price.value) !== 420000) throw new Error("price was not read as 420000");
  return `${parsed.proposals.length} proposals (${keys.join(", ")})`;
});

console.log(failures === 0 ? "\nAll steps passed. Listen to the WAV files to judge the voices." : `\n${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
