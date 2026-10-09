# AI property intake (voice and text)

An agent describes a property by voice or text, in Greek or English, takes photos, and HOME88 saves a **draft**
property through the normal property service. Screen: **Ακίνητα → Νέο ακίνητο → Φωνητική καταχώριση**
(`/properties/new/assistant`). The ordinary form stays available at any time.

## What the AI may and may not do

The model **proposes**; HOME88 decides.

* It never writes to the database and never names a column. It proposes a field key from an allowlist derived from the
  property-type profiles (`@home88/domain` `property-profiles`), a value, and the agent's own words that value came from.
* A value is stored only if its key is allowlisted, it passes that field's own validation (type, range, options), and its
  quoted evidence really appears in what the agent said. Otherwise it is dropped or held as a question
  ("Δεν είμαι σίγουρος: … Είναι σωστό;").
* A value that conflicts with one the agent already gave is asked about, unless the agent says it is a correction.
* Every value has an origin: `AGENT_STATED`, `AGENT_MANUAL`, `SYSTEM_DERIVED` (the title) or `AI_SUGGESTED`. Only the first two
  are the agent's own; the rest stay **unconfirmed and are not saved** until the agent approves them.
* The assistant's replies are fixed Greek/English templates, so it cannot state a fact the agent did not give. The only generated
  prose is the Greek/English *description* suggestion, written from confirmed facts only; a description that contains a number
  that is not one of those facts is discarded.
* Coordinates, owner, status, publication and agent fields cannot be captured by the assistant at all.
* Saving creates a **DRAFT** with `publishedOnWebsite=false`. Nothing is sent to the website or any portal. Photos stay private and
  pending review (the existing media pipeline).

## Conversation

Turn by turn: record or type → the transcript appears in an editable box → the agent sends it → fields are filled and the
assistant asks **one** question → optionally the reply is spoken. Commands the model can recognise: skip, back (undo),
show what is missing, go to the summary, photos later, mute/unmute, change language, accept/decline a confirmation.
Languages: Automatic, Ελληνικά, English; the agent may switch mid-session. The screen's own labels stay Greek.

Drafts are server-side (`property_intake_sessions`), so a closed browser or lost signal resumes where it stopped; unsent text is
also kept in the browser. Creating the property is claimed inside the same transaction that creates it, so a double tap or a retry
returns the same property.

## Voice

* Recording happens in the browser; the clip is converted to 16 kHz mono WAV (works the same on iOS, Android and desktop), at most
  60 seconds and 3 MB, and sent to `POST /api/property-intake/sessions/:id/transcribe`. Audio is held in memory for that request only: it is
  not stored, logged or sent to analytics. It **is** sent to Google (Gemini) for transcription, and the screen says so.
* Spoken replies come from `POST …/speak`, which speaks only the assistant's own latest reply (it accepts no text). If speech fails
  the text is unaffected. The agent can mute, and replay with a tap (iOS needs a tap before it plays sound).
* The CRM's `Permissions-Policy` now allows `microphone=(self)` (it was `()`); the camera policy is unchanged because the
  *Take photo* button opens the phone's own camera app.

## Configuration (server-side only)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | The key. (`AI_Property_Intake` is accepted as an alternative name.) Set it as a **Sensitive** variable on the CRM Vercel project, then redeploy. Restrict the key to the Gemini API. |
| `GEMINI_INTAKE_TEXT_MODEL` | Extraction and text suggestions. Default `gemini-3.5-flash-lite` (also reads `GEMINI_MODEL`). |
| `GEMINI_INTAKE_TRANSCRIBE_MODEL` | Transcription. Defaults to the text model: transcription is an audio prompt to a Flash model. A dedicated transcription model id was **not** found in the installed SDK; set this only after confirming one exists for your project. |
| `GEMINI_INTAKE_TTS_MODEL` / `GEMINI_INTAKE_TTS_VOICE` | Speech. Default `gemini-3.8-flash-tts` (listed by the installed SDK) and voice `Kore`. |
| `INTAKE_MAX_AUDIO_BYTES`, `INTAKE_MAX_UTTERANCE_CHARS`, `INTAKE_AI_TIMEOUT_MS`, `INTAKE_RATE_TURNS/TRANSCRIBE/SPEAK` | Limits (per signed-in user per 10 minutes). |

Without a key the screen still works by touch (fields, review, save); voice, text understanding and spoken replies report
themselves unavailable.

## Smoke test with the real key

`GEMINI_API_KEY=… npx tsx apps/api/src/lib/property-intake/smoke.ts ./out` makes a few paid calls: speaks a Greek and an English
sentence, transcribes those clips, and extracts fields from the transcript. It prints PASS/FAIL per step with the model id, and writes
the WAV files so you can listen. Run it before enabling the feature for agents.

## Not in this release

Owner/contact linking from the assistant (use the property page after saving), photo labelling, hands-free continuous voice,
geocoding or GPS. Photos selected before saving upload right after the draft is saved; if the page is closed before that they are
lost (a warning is shown), and photos can always be added later from the property page.
