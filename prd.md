# AutoPatch API — Product Requirements & Build Spec

*Version 2.0 · Hackathon MVP · 14 Nov 2026 · Readers: the builder, the AI coding agent (opencode / Antigravity), and the judges*

## 0. How to use this document

- This is the single source of truth for the build. Give it to the coding agent as a file and start with: 'Read the whole spec. Summarise your plan in 15 lines and list your assumptions. Do not write code yet.'
- Sections 11 (Agent Operating Contract) and 12 (Milestones) are written for the AI agent and are mandatory.
- Anything listed as out of scope (section 2) must not be built, even if it looks easy.
- The spec is in English on purpose: coding agents follow English specs more reliably. Terms in quotes are exact strings to use in code and UI.

## 1. Executive summary

**One-liner:** Your API provider changed their JSON. Your app never noticed.

AutoPatch is a reverse proxy between a client app and an upstream API. It checks every JSON response against a baseline contract. When the upstream silently changes shape (renamed field, nested object, string instead of number, wrapped array, new date format), AutoPatch asks an LLM for a field-mapping rule, verifies that rule in code, applies it so the client still receives the shape it expects, caches the rule so later requests heal without the LLM, and opens a GitHub Pull Request with a permanent adapter and test.

**Why this is credible, not a toy:**

1. The LLM proposes a mapping rule. Deterministic code applies it. The LLM never writes the response data itself.
2. Every rule is verified before use. If it cannot be verified, the proxy fails loudly with 502 instead of inventing data.
3. Every number on the dashboard is measured at runtime, never hard-coded.

## 2. Goals, non-goals, success criteria

**Goals**

1. Prove the full self-healing loop live in under 2 minutes.
2. Heal 5 drift types plus 1 combined 'v2' change, and fail safely on 1 undeletable-field case.
3. Open a real, mergeable GitHub PR live during the demo.
4. Look and feel like a real SaaS product.

**Out of scope (do NOT build)**

Auth or multi-tenancy; billing; Redis, SQLite or any database server; contract editor UI; nested objects inside the baseline schema; non-JSON bodies; request-body healing; GraphQL or gRPC; semantic drift (e.g. cents becoming dollars); cloud deployment; Docker; mobile layout; React/Next.js build pipeline.

**Success criteria (all measurable)**

| ID | Criterion | Pass condition |
| --- | --- | --- |
| S1 | Healing coverage | All 5 drift scenarios and the combo scenario return HTTP 200 with a body that passes the baseline schema |
| S2 | Safe failure | 'field\_deleted' returns 502 with a diagnostic and no fabricated value |
| S3 | Cache effect | Second request of a healed scenario makes 0 LLM calls and is faster than the first |
| S4 | Measured latency | Dashboard shows measured p50 for verified overhead, cached heal, cold heal. Targets: ≤10 ms, ≤15 ms, 800–1500 ms. Report real numbers even if a target is missed |
| S5 | PR quality | PR opens within about 10 s of first cold heal; adapter test passes with `npx tsx --test` |
| S6 | Demo reliability | 3 consecutive full rehearsals with zero manual fixes |

## 3. Personas and user stories

- **Backend engineer:** 'When a vendor changes their payload, my checkout keeps working and I get a ready PR in the morning.'
- **Engineering lead:** 'I want lower MTTR and fewer 3 a.m. pages caused by upstream changes.'
- **Judge:** 'I want to break something live and watch it heal, with proof that it is real.'

## 4. Functional requirements

### F1 — Transparent reverse proxy and contract registry

- Routes: every request under `/api/*` is forwarded to `UPSTREAM_BASE_URL` with the same method, path, query string, body and headers (including Authorization). Drop only hop-by-hop headers and `host`.
- Contracts are loaded at startup from `contracts/*.json` (format in section 8.1). A contract is matched by method and exact path.
- Validation applies only when a contract matches AND the upstream status is 2xx AND the body is JSON. Everything else passes through unchanged.
- When re-serialising a body, remove `content-length`, `content-encoding` and `transfer-encoding` from the response headers (fetch has already decoded the body).
- Response headers added: `X-AutoPatch-Status` (verified, healed, healed-cached, unrecoverable, passthrough) and `X-AutoPatch-Overhead-Ms`.
- **AC:** curl through the proxy for a baseline payload returns an identical body; overhead is measured with `performance.now()` and excludes upstream time.

### F2 — Drift detection and AI healer

- Drift = baseline validation fails (missing key, wrong type, wrapped structure).
- Compute a structural fingerprint of the upstream payload (section 8.3). Cache key = method + path + fingerprint.
- **Cache hit:** apply the stored rule, re-validate against baseline, return. No LLM call.
- **Cache miss:** sanitise payload to structure only (8.4), call the LLM mapper (8.5), run the rule verification gates (8.2), apply, cache, return, then queue the PR job.
- **Single-flight:** concurrent requests with the same cache key wait on one shared LLM call.
- Persist rules to `data/rules.json` on every change and reload on startup, so a pre-warmed cache survives restarts.
- **AC:** the same scenario called 10 times makes exactly 1 LLM call.

### F3 — Autonomous GitHub PR generator

- Triggered asynchronously once per unique (endpoint, fingerprint). It must never delay or break the client response.
- Code is generated from templates driven by the verified rule (not free-form LLM code), so it always compiles. An optional LLM-written PR summary is allowed, with a template fallback.
- Details in section 8.7.
- **AC:** the PR contains an adapter file, a test file and a body describing what changed upstream.

### F4 — Live dashboard ('Console')

- WebSocket live feed with badges: '200 VERIFIED', '200 AUTO-HEALED' (with a 'CACHED' chip when from cache), '502 UNRECOVERABLE', and a neutral 'PASSTHROUGH'.
- Chaos Lab: one button per scenario plus 'Reset to baseline' and 'Clear rule cache'.
- Healing Inspector: before payload, after payload, and the rule table for the latest heal.
- Metric cards: Crashes Prevented (count of AUTO-HEALED responses), Cold Heal Latency (mean), Cached Heal Latency (mean), PRs Opened. Optional fifth: LLM calls saved.
- Visible pill showing 'LLM: live' or 'LLM: mock'. Mock mode must never be hidden.

### F5 — Demo client app ('Acme Billing')

- A separate page at `/demo` that fetches the user endpoint and renders name, email, balance and verified state, with a connection switch: 'Direct to upstream' or 'Via AutoPatch'.
- It deliberately uses the baseline field names (`user.email.toLowerCase()`, `user.account_balance.toFixed(2)`). When the upstream drifts and the connection is direct, the real exception is caught and shown on a crash screen with the actual error message. Nothing is faked: the crash is genuine.

### F6 — Configuration and safety

- All config via `.env` (section 7.4). `.env.example` committed, `.env` git-ignored.
- Secrets are never logged and never sent to the LLM.

## 5. Non-functional requirements

- **Latency targets** (localhost, excluding upstream time): pass-through overhead ≤10 ms; cached heal ≤15 ms; cold heal typically 800–1500 ms. These are targets, not claims: the UI shows measured values only.
- **Privacy:** only structure and value classes go to the LLM (8.4). Demo data is synthetic, because free-tier prompts may be used by the provider to improve its products.
- **Fault tolerance:** low confidence, unmappable required field, LLM timeout, invalid LLM output, or failed verification all end in 502 'AUTOPATCH\_UNRECOVERABLE' with a diagnostic. Never fabricate data.
- **Honesty:** no hard-coded metrics, no fake logs, no pretend PRs. Mock mode is labelled.
- **Resilience:** the proxy keeps serving verified and cached traffic even if Gemini or GitHub is unreachable.

## 6. Architecture and request lifecycle

```text
[Acme Billing client] -> [AutoPatch :8080] -> [Mock upstream :4000]
                              |
   contract match? -> no  -> pass through
                   -> yes -> validate 2xx JSON
        valid -> return (VERIFIED)
        invalid -> fingerprint -> cache hit -> apply rule -> return (AUTO-HEALED, cached)
                              -> miss -> sanitise -> LLM mapper -> verify rule -> apply -> cache -> return (AUTO-HEALED)
                                                                          \-> async PR worker -> GitHub
        any failure -> 502 UNRECOVERABLE
Every event -> WebSocket hub -> Console UI
```

| Case | Behaviour | Badge |
| --- | --- | --- |
| No contract, non-JSON, or non-2xx upstream | Pass through untouched | PASSTHROUGH |
| Valid against baseline | Return as-is | 200 VERIFIED |
| Invalid, rule cached | Apply rule, re-validate, return | 200 AUTO-HEALED + CACHED |
| Invalid, no rule | Single-flight LLM, verify, apply, cache, return, queue PR | 200 AUTO-HEALED |
| Any heal failure | 502 JSON: error, reason, missingFields, signature | 502 UNRECOVERABLE |
| Upstream unreachable | 502 with reason 'UPSTREAM\_UNREACHABLE' | 502 UNRECOVERABLE |

## 7. Tech stack and project setup

### 7.1 Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js current LTS (≥20), TypeScript strict | check with `node -v` |
| Dev runner | tsx | `tsx watch` for dev |
| Server | Fastify + @fastify/websocket + @fastify/static | one process for proxy, API, UI |
| Upstream calls | Node global `fetch` | no proxy library; keeps control of headers and timing |
| Validation | Zod | baseline schema built programmatically; no coercion during validation |
| LLM | @google/genai (Google Gen AI SDK) | model from `GEMINI_MODEL` env; free-tier Flash-class model |
| GitHub | @octokit/rest | fine-grained token on one demo repo |
| Tests | Vitest (app), `node:test` (generated adapter tests) | generated tests have zero dependencies |
| Config | dotenv | `.env` + `.env.example` |
| Frontend | static HTML + CSS + vanilla JS modules | no build step |
| UI libs | Tailwind (Play CDN), Lucide icons, Inter + JetBrains Mono | vendor copies into `public/vendor/` at M6 so the demo works offline |
| Storage | in-memory Map + `data/rules.json` | no database |

### 7.2 Version policy

Install the latest stable of each package, then pin with `npm install --save-exact` and commit the lockfile. Do not upgrade during the hackathon. Never assume an API from memory: confirm it against the installed package's type definitions (section 11).

### 7.3 Folder structure

```text
autopatch/
  contracts/checkout-user.json
  data/rules.json            (generated, git-ignored)
  public/ console.html  demo.html  app.js  styles.css  vendor/
  scripts/ prewarm.ts  smoke.ts
  src/
    server.ts  config.ts  metrics.ts  events.ts
    proxy/ handler.ts  forward.ts
    contracts/ registry.ts  validator.ts
    healer/ fingerprint.ts  sanitizer.ts  llm.ts  rule.ts  engine.ts  cache.ts  heal.ts
    github/ codegen.ts  pr.ts  queue.ts
    mock-upstream/ server.ts  scenarios.ts
  test/ *.test.ts
  DECISIONS.md  README.md  .env.example  .gitignore
```

### 7.4 Environment variables

`PORT=8080`, `UPSTREAM_BASE_URL=http://localhost:4000`, `MOCK_UPSTREAM_PORT=4000`, `LLM_MODE=live|mock`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `LLM_TIMEOUT_MS=8000`, `MIN_CONFIDENCE=0.7`, `PR_ENABLED=true|false`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH` (optional, default is the repo default branch), `DATA_DIR=./data`.

### 7.5 Ports and routes

- `:8080` AutoPatch. Proxy: `/api/*`. UI: `/console`, `/demo`. Internal: `/__autopatch/*` (reserved prefix).
- `:4000` mock upstream: `GET /api/v1/checkout/user`, `GET|POST /__control/chaos` (CORS enabled so the demo can call it directly).
- Internal API: `GET /__autopatch/api/state`, `POST /__autopatch/api/chaos` (forwards to the mock), `POST /__autopatch/api/cache/clear`, `POST /__autopatch/api/metrics/reset`, `GET /__autopatch/api/rules`, WebSocket `/__autopatch/ws`.

## 8. Data contracts and algorithms

### 8.1 Baseline contract

```json
{
  "endpoint": "/api/v1/checkout/user",
  "method": "GET",
  "expected_schema": {
    "user_id": "string",
    "email": "string",
    "account_balance": "number",
    "is_verified": "boolean",
    "created_at": "iso_datetime"
  }
}
```

Type vocabulary (MVP, flat top-level fields only): `string`, `number` (finite), `boolean`, `iso_datetime` (string that matches ISO-8601 and parses to a valid date). The `created_at` field is added to the original PRD so the date-format drift can be shown.

### 8.2 Mapping rule and verification gates

```json
{
  "fields": {
    "user_id": {"from": "id", "coerce": "none"},
    "email": {"from": "contact.email_addr", "coerce": "none"},
    "account_balance": {"from": "balance", "coerce": "number"},
    "is_verified": {"from": "verified", "coerce": "boolean"},
    "created_at": {"from": "created", "coerce": "iso_datetime"}
  },
  "unmappable": [],
  "confidence": 0.95,
  "reasoning": "short text for the PR body"
}
```

- `from`: dot path with optional index, e.g. `data[0].email`, or `null` when no equivalent exists.
- `coerce`: `none`, `string`, `number`, `boolean`, `iso_datetime`.
- Coercion rules (deterministic, in `rule.ts`): number accepts a finite number or a numeric string (reject NaN, empty); boolean accepts true/false, 1/0, 'true'/'false', 'yes'/'no' (case-insensitive); iso\_datetime accepts an ISO string, or a number (below 1e12 means epoch seconds, otherwise milliseconds) and outputs UTC ISO-8601; string accepts string, number, boolean. Any other input throws, which becomes 502.

**A rule is cacheable only if ALL gates pass:**

1. The rule parses with Zod and every baseline field has an entry.
2. Every non-null `from` path resolves in the actual sample payload (the LLM cannot invent a path).
3. `confidence` ≥ `MIN_CONFIDENCE`.
4. Applying the rule to the sample payload produces an object that passes the baseline schema.
5. No required field is in `unmappable`.

### 8.3 Structural fingerprint

Canonical string built recursively: object = sorted `key:fingerprint` pairs; primitives = `string|number|boolean|null`; array = `[fingerprint of first element]` or `[]` if empty. Fingerprint = sha1 (node:crypto) of that string. Same structure with different values gives the same fingerprint, which is what makes cache hits work.

### 8.4 Sanitiser (privacy)

Keep keys. Replace each leaf with a value class only: `string`, `string:numeric`, `string:iso_datetime`, `string:email_like`, `number:int`, `number:float`, `number:epoch_like` (integer between 1e9 and 4e12), `boolean`, `null`. Raw values, headers and tokens are never sent to the LLM.

### 8.5 LLM mapper

- Input: baseline `expected_schema` plus the sanitised upstream structure.
- System instruction (summary): you map upstream fields onto the expected contract; use only paths that exist in the provided structure; never invent fields or values; if no equivalent exists set `from` to null and list the field in `unmappable`; output JSON only.
- Call settings: temperature 0, JSON output mode with a response schema (check the exact parameter names in the installed SDK types), timeout `LLM_TIMEOUT_MS`, one retry only on 429, 5xx or network errors.
- The response is untrusted input: parse it, validate with Zod, run the gates in 8.2. Never `eval` or execute anything from it.
- `LLM_MODE=mock` returns canned rules for the six scenarios, used only by unit tests and smoke tests. The UI shows 'LLM: mock' whenever it is active.

### 8.6 Chaos scenarios (mock upstream)

Baseline payload: `{"user_id":"usr_99","email":"dev@acme.io","account_balance":450.5,"is_verified":true,"created_at":"2026-11-14T09:30:00Z"}`

| Mode | What changes upstream | Expected outcome |
| --- | --- | --- |
| `none` | Baseline | VERIFIED |
| `rename` | `user_id` becomes `id`, `email` becomes `user_email` | AUTO-HEALED |
| `nest` | `email` moves to `contact.email_addr` | AUTO-HEALED |
| `type_mismatch` | `account_balance` is `"450.50"`, `is_verified` is `1` | AUTO-HEALED |
| `array_wrap` | Whole payload becomes `{"data":[ {baseline} ]}` | AUTO-HEALED |
| `date_shift` | `created_at` becomes epoch seconds (compute with `new Date` in tests) | AUTO-HEALED |
| `combo_v2` | `{"id":"usr_99","contact":{"email_addr":"dev@acme.io"},"balance":"450.50","verified":1,"created":<epoch seconds>}` | AUTO-HEALED (headline demo) |
| `field_deleted` | `email` removed entirely | 502 UNRECOVERABLE |

### 8.7 GitHub PR specification

1. Read the repo's default branch (or use `GITHUB_BASE_BRANCH`) and its head SHA.
2. Create branch `autopatch/fix-schema-<timestamp>`.
3. Commit two files via the contents API on that branch: `src/adapters/<slug>.ts` (the adapter function plus tiny inline coercion helpers) and `src/adapters/<slug>.test.ts` (a `node:test` test with the captured sample before and after). Slug = endpoint with slashes turned to dashes, e.g. `api-v1-checkout-user`.
4. Open a PR with title 'AutoPatch: adapt \<endpoint> to upstream schema change'. The body contains: what changed (diff of old and new fingerprints: removed, added, type-changed paths), the rule as a table, the verification result, the model used, and the line 'Generated automatically. Please review before merging.'
5. Before step 2, verify in-process that the generated adapter, run on the sample, equals the rule engine's output. Only then call GitHub. The PR is 'verified' in that sense, and the body says exactly what was verified and nothing more.
6. Dedupe on (endpoint, fingerprint). Failures emit a 'pr' event with state 'failed' and the real error; the client response is unaffected.

**Token:** fine-grained personal access token limited to the demo repo with Contents: read and write, and Pull requests: read and write.

### 8.8 WebSocket events

- `request`: id, ts, method, path, status (VERIFIED, AUTO\_HEALED, UNRECOVERABLE, PASSTHROUGH), cached (bool), httpStatus, upstreamMs, overheadMs, healMs, fingerprint.
- `heal`: before (sanitised structure and, for the inspector only, the raw synthetic payload), after, rule, reasoning.
- `pr`: state (queued, creating, opened, failed), url, branch, error.
- `chaos`: mode. `metrics`: the four counters plus LLM calls.

## 9. Design system (SaaS startup, dark console)

**Style:** modern developer-tool SaaS in the spirit of Linear and Vercel. Dark, calm, dense but airy, with one accent colour and clear status colours. The 'Acme Billing' demo app is deliberately light and different, so the audience sees two separate products.

### 9.1 Tokens

| Token | Value | Use |
| --- | --- | --- |
| bg | `#09090B` | page |
| surface | `#111114` | cards |
| surface-2 | `#18181B` | inputs, table header |
| border | `#27272A` | 1 px lines |
| text | `#FAFAFA` | primary text |
| muted | `#A1A1AA` | secondary text |
| accent | `#6366F1` | primary buttons, active nav, focus ring |
| verified | `#10B981` | 200 VERIFIED |
| healed | `#22D3EE` | 200 AUTO-HEALED |
| danger | `#EF4444` | 502 UNRECOVERABLE |
| chaos | `#F59E0B` | Chaos Lab accents |

Radius 12 px for cards, 8 px for buttons and badges. Card shadow: none; instead a 1 px border plus a faint top gradient glow in the accent colour at about 6% opacity.

### 9.2 Typography

Inter for UI. JetBrains Mono for JSON, paths, latency and fingerprints (use tabular numbers for metrics). Sizes: page title 20/28 semibold, card title 14/20 medium, body 13–14, mono 12–13. Always include system-font fallbacks.

### 9.3 Layout (target 1280–1920 px wide, optimised for projector)

- **Left sidebar, 240 px:** logo mark plus 'AutoPatch' wordmark; nav anchors: Live Traffic, Chaos Lab, Healing Inspector, Pull Requests; footer shows LLM mode and a connection dot.
- **Top bar:** page title, environment pill 'Demo', upstream health dot, WebSocket status.
- **Row 1:** 4 metric cards with count-up animation and a small sparkline-free delta line.
- **Row 2:** Live Traffic table (8 columns of 12) beside Chaos Lab (4 columns).
- **Row 3:** Healing Inspector (8) with before/after JSON and rule table, beside Auto-PR card (4) showing branch, state stepper and a large 'Open Pull Request' button when ready.

### 9.4 Components and behaviour

- **Badges:** pill with a coloured dot and the exact label; AUTO-HEALED has a 'CACHED' chip when applicable; show latency in mono, e.g. `1,120 ms` for cold and `3 ms` for cached.
- **Traffic rows:** new rows slide in over 200 ms and keep the newest 50. Click a row to load it into the Inspector.
- **Chaos Lab:** a card per scenario with icon, name and one-line description. The active mode is highlighted with an amber outline. A primary 'Simulate breaking change' button for `combo_v2`, secondary buttons for the individual modes, and a ghost 'Reset to baseline' button.
- **Inspector:** two-column JSON view; removed keys in red, added keys in green, changed types in amber; below it a table of target field, source path, coercion.
- **PR card:** stepper Queued, Creating branch, Committing, PR opened. On failure show the real error text.
- **Toasts** for actions, **empty states** with a friendly line ('No traffic yet. Send a request from Acme Billing.'), **skeleton** while connecting.
- **Icons (Lucide):** shield-check, zap, git-pull-request, activity, flask-conical, rotate-ccw, alert-triangle.
- **Accessibility:** contrast at least 4.5:1, visible focus ring, never rely on colour alone (labels stay on badges), respect `prefers-reduced-motion`.
- **Microcopy:** short and confident, no jokes in error states.

### 9.5 Acme Billing demo app

Light theme, white card, neutral grey, a green primary button. Components: connection switch (Direct / Via AutoPatch), 'Refresh' button, user card, and the crash screen: red banner 'Application error' with the real exception message and stack first line.

## 10. Demo script and pitch

**Setup:** two browser windows side by side: `/demo` (Acme Billing) and `/console`. Cache cleared for the live heal, or use a pre-warmed scenario for the speed demo.

| Time | Action | What the judge sees |
| --- | --- | --- |
| 0:00–0:20 | One-line pitch, then Refresh in Acme Billing via AutoPatch | Green VERIFIED row, user card renders |
| 0:20–0:45 | Click 'Simulate breaking change' (combo\_v2). Switch Acme Billing to Direct and Refresh | Genuine crash screen with a real TypeError |
| 0:45–1:20 | Switch to Via AutoPatch and Refresh | AUTO-HEALED row with cold latency, inspector shows before and after, user card renders |
| 1:20–1:35 | Refresh again | AUTO-HEALED + CACHED in a few ms; LLM calls stays at 1 |
| 1:35–1:50 | Switch to the GitHub tab | A new PR with adapter, test and a clear body |
| 1:50–2:00 | Click 'field\_deleted' and refresh | 502 UNRECOVERABLE with a diagnostic: 'we never invent data' |

**Pitch slides (6):** problem with a real-world example; solution in one diagram; live demo; architecture and the 'LLM proposes, code verifies' principle; business model; roadmap and ask.

**Likely judge questions**

- 'What if the LLM maps wrongly?' Five verification gates, a confidence threshold, safe 502 failure, and every permanent fix lands as a reviewable PR.
- 'Latency?' Show the measured numbers on screen. Cached healing makes no LLM call.
- 'Data privacy?' Only structure and value classes leave the proxy.
- 'Which changes can it not handle?' Semantic changes such as unit changes; flag them honestly as roadmap.

## 11. Agent Operating Contract (anti-hallucination rules)

These rules bind the AI coding agent for the whole build.

1. **Read first.** Read this entire spec. Reply with a plan of at most 15 lines and a list of assumptions before writing code.
2. **Never invent.** Do not make up package names, function signatures, API endpoints, env vars, model names or CLI flags. Confirm with `npm view <pkg> version`, by reading `node_modules/<pkg>/**/*.d.ts` and README, or official docs if a fetch tool exists. If something cannot be verified, say so and choose the documented fallback or ask. Do not guess.
3. **Allowed dependencies only** (section 7.1). Adding another needs a one-line justification in `DECISIONS.md`.
4. **No hard-coded secrets or model names.** Everything comes from `.env`.
5. **No fake data in the UI.** Every number is measured from real events. Mock mode is always labelled. Never show a success that did not happen.
6. **No placeholders.** No TODO stubs, no 'implement later', no `any` or `@ts-ignore` to silence errors. `tsc --noEmit` must be clean.
7. **Prove it.** After each milestone: build, run tests, run the manual curl or UI check, and paste the commands and real output. Do not say 'done' without running it.
8. **One milestone at a time.** Make a local git commit per milestone. Do not start the next until the gate is green.
9. **Ambiguity:** pick the simplest option consistent with the spec, record it in `DECISIONS.md`, move on. Do not expand scope.
10. **Errors:** show the real error. Never swallow exceptions or mask failures as success.
11. **LLM output is untrusted.** Parse, validate with Zod, apply the gates. Never execute it. Treat GitHub responses the same way.
12. **Security:** tokens only in `.env`, never logged, `.env` in `.gitignore`. Never send raw values or headers to the LLM.
13. **Do not edit this spec.** Propose changes in `DECISIONS.md`.

**Things the agent must verify from the installed packages (not memory):** Gemini SDK client construction, the generate-content method, JSON mode and response-schema parameter names; Octokit method names for refs, contents and pulls; the @fastify/websocket handler signature; the exact Tailwind and Lucide CDN URLs and versions.

## 12. Milestones and gates

| # | Scope | Gate (must be green before moving on) | Est. |
| --- | --- | --- | --- |
| M0 | Repo, tsconfig strict, deps pinned, `.env.example`, `.gitignore`, folder skeleton | `npm run build` passes | 30 min |
| M1 | Mock upstream with 8 modes, proxy forwarding, contract registry, validator, VERIFIED path | curl via proxy returns baseline body; overhead header present | 2 h |
| M2 | Fingerprint, sanitiser, rule engine, coercions, gates, cache + disk persistence, mock LLM | Vitest passes all 6 scenarios plus failure cases | 2 h |
| M3 | Live Gemini mapper, timeout and retry, single-flight, 502 diagnostics | combo\_v2 heals live; second call makes 0 LLM calls | 1.5 h |
| M4 | Event hub, WebSocket, Console UI, Chaos Lab, Inspector, Acme Billing with genuine crash | UI shows every status live; crash screen shows the real error | 4 h |
| M5 | PR codegen, in-process verification, Octokit flow, PR card | A real PR appears in the demo repo and its test passes | 2 h |
| M6 | Vendor CDN assets, prewarm script, smoke script, README, rehearsal x3, backup screen recording | S1–S6 all green | 2 h |

Budget about 14 hours of focused work; sleep is part of the plan.

## 13. Testing checklist

**Unit (Vitest):** fingerprint stable across values and different across structures; sanitiser leaks no raw value; each coercion including failure cases; path resolver with arrays; each verification gate rejects a bad rule; cache persistence round trip; single-flight makes one call.

**Integration/smoke script:** boot mock and proxy, run all 8 modes, assert statuses, bodies and LLM call counts, print a pass/fail table.

**Manual before demo:** run the full demo script three times; confirm the PR renders correctly on GitHub; kill the network once and confirm cached heals still work.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Gemini free-tier rate limit or outage | `npm run prewarm` fills the cache with real LLM-generated rules; rules persist on disk; the demo still shows one live cold heal |
| Venue Wi-Fi | Everything runs on localhost; vendor CDN files; use a phone hotspot for Gemini and GitHub |
| GitHub token or API failure | Test the token early; keep one pre-created PR as backup; PR errors never affect responses |
| LLM maps wrongly | Verification gates and 502 failure; PR is reviewed by a human |
| Scope creep | Out-of-scope list; one milestone at a time |
| Agent hallucinates APIs | Section 11 rules; type definitions as source of truth |

## 15. Business model, roadmap, honest limits

**Model:** open-core proxy plus hosted SaaS priced by monitored endpoints and request volume; team tier with PR automation and Slack alerts; enterprise tier self-hosted in the customer's VPC.

**Roadmap:** multi-endpoint contracts from OpenAPI import; nested baseline schemas; 'shadow mode' that logs proposed heals without serving them; human-approval mode before a rule goes live; GitLab and Bitbucket; Python and Go adapters; semantic-drift detection.

**Limits (say these out loud, judges respect it):** AutoPatch heals structural drift, not meaning changes; it needs a baseline contract; mappings are inferred, so production use should start in shadow mode and always go through PR review.

## 16. Starter prompt for the coding agent

```text
Read AUTOPATCH_SPEC.md completely. Follow section 11 strictly.
Step 1: reply with a plan (max 15 lines) and your assumptions. Do not write code.
After I approve, build ONE milestone at a time (section 12), run the gate checks,
show me the real command output, commit locally, then wait for my go-ahead.
If you cannot verify an API from the installed package types, say so instead of guessing.
```
