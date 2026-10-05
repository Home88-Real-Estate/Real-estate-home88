# Public AI assistant (Gemini)

The floating fox assistant on the public website (`apps/web`). Phase 1: chat,
real property search/details, and three CRM actions through the existing
public intake service.

## Flow

```
browser widget ──► POST /api/ai/chat (apps/web, Node runtime)
                      │  rate limit, size limits, validation
                      ▼
                 Gemini (@google/genai, server only)
                      │  function calls only
                      ▼
                 typed tools (apps/web/src/lib/ai/tools.ts)
                   ├─ search_properties / get_property_details → lib/property.ts (published + public statuses only)
                   ├─ create_property_inquiry / create_viewing_request / create_buyer_request
                   │     → PublicLeadIntakeService (@home88/intake): 18+ age gate, contact
                   │       de-duplication, consent ledger, idempotency, CRM notification
                   └─ get_home88_contact_information → Settings (lib/company.ts)
```

Gemini never receives database access, SQL, private CRM fields, or the key.
Property cards in the UI are built from tool results, never from model text.

## Configuration (server environment only)

| Variable | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Set in the deployment's secret store (e.g. Vercel → Project → Settings → Environment Variables) for each environment. Never `NEXT_PUBLIC_`. Without it the widget is not rendered and the endpoint answers 503 with a friendly fallback. |
| `GEMINI_MODEL` | no | Defaults to `gemini-flash-latest` (Google's current Flash alias). Pin a model name to freeze behaviour. |
| `AI_RATE_LIMIT_POINTS`, `AI_RATE_LIMIT_WINDOW_SECONDS` | no | Per-IP chat limit, default 20 / 600 s. Write actions are additionally limited to 5 / 600 s per IP. |
| `AI_MAX_MESSAGE_CHARS`, `AI_MAX_OUTPUT_TOKENS`, `AI_TIMEOUT_MS`, `AI_MAX_TOOL_ROUNDS` | no | Cost/latency bounds; see `apps/web/src/lib/ai/config.ts`. |

The rate limiter is in-process (see `lib/rate-limit.ts`): on more than one
instance the effective limit multiplies until the shared limiter is wired in.

## Records it creates

All through `PublicLeadIntakeService`, so they are the same records the
website forms create, with `Lead.sourceChannel = "AI_ASSISTANT"`, the page the
chat was opened on as `landingPage`, and an `[AI Assistant]` prefix on the
message/notes. The visitor must give a name, an email or phone, a date of
birth (checked for 18+, never stored), and explicitly agree to processing.
Repeats within one chat session are idempotent. A viewing is only ever a
`REQUESTED` viewing request.

## Tests

- `apps/web/src/lib/ai/ai.test.ts` — endpoint, Gemini failure/timeout, tool
  validation, prompt-injection and secret-leak checks (scripted model).
- `apps/web/src/lib/ai/ai.integration.test.ts` — tools against real Postgres
  (`INTAKE_TEST_DATABASE_URL`), including visibility, de-duplication,
  idempotency and the age gate.
- `apps/web/e2e/assistant.ui.mjs` — browser checks of the widget
  (`npm run test:ui -w @home88/web` against a running site).

None of these call Gemini. A live check needs `GEMINI_API_KEY` in the server
environment.
