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
| `GEMINI_INTAKE_TRANSCRIBE_MODEL`, `GEMINI_INTAKE_TRANSCRIBE_MODE` | Transcription. Default `gemini-3.5-flash` (an audio prompt to the full Flash model, with language codes and vocabulary). `asr` mode uses a dedicated recogniser through `audioTranscriptionConfig`; see "Release 2.1". A refused model falls back to the text model. |
| `GEMINI_INTAKE_TTS_MODEL` / `GEMINI_INTAKE_TTS_VOICE` | Speech. Default `gemini-3.8-flash-tts` (listed by the installed SDK) and voice `Kore`. |
| `INTAKE_MAX_AUDIO_BYTES`, `INTAKE_MAX_UTTERANCE_CHARS`, `INTAKE_AI_TIMEOUT_MS`, `INTAKE_RATE_TURNS/TRANSCRIBE/SPEAK/PHOTOS` | Limits (per signed-in user per 10 minutes). |

Without a key the screen still works by touch (fields, review, save); voice, text understanding and spoken replies report
themselves unavailable.

## Smoke test with the real key

`GEMINI_API_KEY=… npx tsx apps/api/src/lib/property-intake/smoke.ts ./out` makes a few paid calls: speaks a Greek and an English
sentence, transcribes those clips, and extracts fields from the transcript. It prints PASS/FAIL per step with the model id, and writes
the WAV files so you can listen. Run it before enabling the feature for agents.

## Release 2

**Owner.** The "Ιδιοκτήτης" panel picks an *existing* contact by touch: search by name, company, contact reference, phone or email (the last
two are matched by hash, so typing them finds the contact). Results show only a name, reference, city, roles and the last four digits of
a phone. The session keeps the contact id and display name, nothing else, and the assistant is never given a phone or email: do not
dictate them. A new contact is created from the normal contact form ("Νέα επαφή"). When the draft is saved, the contact is linked as
primary `OWNER` (the same `PropertyOwner` record the contact page uses) in the same transaction as the property, once. If the contact was
deleted in between, the draft is still saved and the screen says the owner was not linked. Choosing an owner never publishes anything.

**Photo labels.** "Πρόταση ετικετών από AI" (only when pressed) sends small previews (long edge 640 px, up to 12 per request) to Gemini,
which picks one room or view per photo from a fixed list. Previews are checked server-side (a real JPEG/PNG/WebP whose bytes match its
declared type), held in memory for the request, never stored or logged, and the model is told not to identify people or read text.
Suggestions are unaccepted until the agent accepts or changes them. Accepted labels become the photo's Greek and English alternative
text after upload; "Other" sets none. Rate limit: `INTAKE_RATE_PHOTOS` (default 15 requests per 10 minutes per user).

**Photos survive a closed tab.** Picked photos are kept in this device's IndexedDB (never sent anywhere) until each is uploaded, then
removed; stale ones are purged after a week. Reopening the draft restores them in order. If the draft was already saved but the tab
closed mid-upload, a notice offers to upload the remainder. If the browser blocks or fills storage, the screen says so and the earlier
"do not close the page" warning still applies. Labels are kept in `localStorage` per draft.

**Hands-free.** The 🎧 toggle listens for speech from the microphone level (on the device; nothing is sent until speech is heard),
stops after a pause, transcribes, shows the text with a 3-second "send now / cancel" countdown, sends, speaks the reply, and listens
again. The microphone is never open while the assistant speaks. It switches itself off after three silent rounds, when the page is
hidden, when the draft is saved, or on any provider error. The screen is kept awake where the browser allows it.

## Release 2.1: Greek recognition, listing text after Send, five-step screen

**Why Greek was recognised poorly (from the code, not measured on live audio).** Speech went to the Lite text
model through a generic prompt, with no BCP-47 language code and no real-estate vocabulary; the language buttons
changed one sentence of that prompt. Recording and encoding were sound (16 kHz mono WAV, complete before upload).
A production report also showed "Δεν δόθηκε άδεια για το μικρόφωνο": that is the browser's microphone permission
for the site, not recognition; it is reset from the padlock / site settings.

**Transcription now.** `GEMINI_INTAKE_TRANSCRIBE_MODEL` (default `gemini-3.5-flash`, the full model) with:
- the agent's language as codes: Ελληνικά → `el-GR`, English → `en-US`, Αυτόματα → both as hints;
- a vocabulary of ≤120 phrases from HOME88's own property types and field names plus agents' terms;
- numbers written as digits and self-corrections kept, so the editable transcript is easy to check.
A dedicated recogniser is supported through the SDK's documented `audioTranscriptionConfig` (`languageCodes`,
`customVocabulary`, `mode: VERBATIM`): set `GEMINI_INTAKE_TRANSCRIBE_MODE=asr`, or use a model id containing
"transcribe". Its exact id could not be verified from this environment (Google's documentation site was
unreachable and the installed SDK lists no such model), so it is opt-in. If a model id or option is refused
(HTTP 400/404) the recording is transcribed with the text model instead of failing. The transcript is always
shown for review before it is sent (by hand, or after the hands-free countdown).

**Send fills the draft.** Audio → transcript (editable) → structured proposals (allow-listed keys, validated,
quoting the agent's words) → merged into the draft (agent-confirmed values are never overwritten silently; a
conflict is asked) → titles and descriptions refreshed → reply. The reply says what was understood ("Ωραία,
κατέγραψα: διαμέρισμα, προς πώληση, περιοχή Γλυφάδα, 95 τ.μ., 3ος όροφος, 2 υπνοδωμάτια, τιμή €350.000.") and asks
one question: the essentials, then at most four details of that property type.

**Titles and descriptions** are written after every turn that changes confirmed facts (and titles after a touch
correction): titles deterministically (place names in Latin letters for English), descriptions by the model and
discarded if they contain a number that is not a fact. All four arrive as unapproved proposals; anything the agent
wrote or approved is never replaced. On step 5 each can be approved, edited, rejected, or regenerated ("Νέα
πρόταση"). The model is not called again when nothing changed.

**Screen.** Five steps (Περιγραφή · Βασικά στοιχεία · Χαρακτηριστικά · Φωτογραφίες · Έλεγχος & αποθήκευση),
free to move between, compact on a phone; a live summary beside the conversation; basic details in cards; the
characteristics of the property's own profile first, features as one-tap chips, everything else behind a search
instead of a 100-item dropdown; a review that separates what is required to save a draft from what is needed
before activation; a sticky Back / Continue / Save bar that sits above the phone tab bar.

## Not in this release

Voice-driven owner details (deliberately, see above), room-aware photo ordering, geocoding or GPS, creating a contact from the
assistant, offline creation of a draft with a sync queue (photos and unsent text are kept on the device, but saving
the draft needs a connection), document/legal checklists and mandates inside this flow.

Tested here with a simulated microphone (a looping audio file fed to a real Chromium) and a scripted AI; a real phone, a real
microphone in a noisy room, Bluetooth headsets and iOS Safari behaviour have not been tested.
