# AutoPatch

**Self-Healing Reverse Proxy for Silently Drifting Upstream JSON APIs**  
*Built by Team Coders of Bharat (Lead: Anirudh Verma) for Google Startup Buildathon India 2026.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![Google AI Studio](https://img.shields.io/badge/Google%20AI%20Studio-Gemini%202.0%20Flash-4285F4.svg)](https://aistudio.google.com/)
[![Tests](https://img.shields.io/badge/Vitest-92%20passed-brightgreen.svg)](https://vitest.dev/)
[![Zero PII](https://img.shields.io/badge/Compliance-Zero--PII%20Sanitized-emerald.svg)]()

> *"Your upstream API provider changed their JSON schema at 2 AM. Your checkout app never noticed."*

AutoPatch sits transparently between your client application and upstream APIs. When third-party providers introduce silent breaking schema changes (renamed fields, altered nesting, string/number type mismatches, wrapped arrays, epoch date shifts), AutoPatch:
1. **Detects** the contract violation using deterministic runtime validation.
2. **Sanitizes** the payload before transmission (stripping all real values to value classes for **Zero-PII Compliance**).
3. **Infers** field mapping rules using **Google Gemini 2.0 Flash** via Google AI Studio.
4. **Verifies** the proposed fix through **5 Programmatic Safety Gates** (refusing to hallucinate missing data).
5. **Caches** verified rules in memory (yielding subsequent sub-millisecond **0.14 ms** heal latency).
6. **Autonomously Opens** a GitHub Pull Request with a typed TypeScript adapter and `node:test` regression suite.

---

## Google AI Integration & Architecture

AutoPatch leverages **Google AI Studio** and **Google Gemini 2.0 Flash** as its core mapping engine:

```
[Client App] ──> [AutoPatch Proxy :8080] ──> [Upstream API :4000]
                        │
             Contract Match & 2xx?
             ├── Valid ──> Fast Return (0.08 ms overhead)
             └── Drift Detected!
                     │
         [Structural Fingerprint]
                     │
             Cache Hit? ──Yes──> Local In-Memory Transform (0.14 ms) ──> Client (200 OK)
                     │
                    No (Cold Miss)
                     │
         [Zero-PII Sanitizer] (Masks values: <STRING_EMAIL>, <NUMERIC_FLOAT>)
                     │
         [Google Gemini 2.0 Flash] (Schema Inference with Temperature=0)
                     │
         [5 Deterministic Safety Gates]
             ├── G1: Baseline Schema Coverage (100% fields mapped)
             ├── G2: Source Path Resolution inside real payload
             ├── G3: Confidence Threshold (>= 0.70)
             ├── G4: In-Process Execution & Contract Re-Validation
             └── G5: Completeness (Rejects deletion of required fields -> 502)
                     │
             Passed All 5 Gates?
             ├── Yes ──> [Memory Cache] ──> Return Healed JSON (200 OK)
             │                 │
             │           [Octokit Async Worker] ──> GitHub PR with Adapter & Test
             └── No  ──> Strict 502 Fail-Closed (Zero Hallucinated Values)
```

---

## 5 High-Impact Enterprise Features

### 1. Traffic Auto-Profiling (Zero-Config Schema Learning)
Developers no longer write manual schemas for 50+ endpoints. In **Learn Mode**, AutoPatch profiles healthy `200 OK` responses, infers field types (`string`, `number`, `boolean`, `iso_datetime`), and automatically locks baseline contracts. Onboarding drops from hours to **30 seconds**.

### 2. Enterprise Shadow Mode & Canary Healing
* **Active Self-Heal (100%):** Real-time automated production healing.
* **Canary Healing (5%):** Heals 5% of drifted traffic while monitoring error rates before 100% rollout.
* **Shadow Mode (Observe Only):** Detects drift, runs Gemini inference, executes 5-Gate validation, generates GitHub PRs, and logs *"Would have healed in 0.14 ms"* without altering live client traffic.

### 3. Bidirectional Outbound & Inbound Healing
In addition to response drift, AutoPatch intercepts outbound `400 Bad Request` / `422 Unprocessable Entity` validation errors (e.g. deprecated `{ phone }` vs required `{ customer: { mobile } }`), transforms outbound request bodies, and retries transparently.

### 4. Human-in-the-Loop Webhook Incident Alerts
When Gate 5 blocks an unmappable field (e.g., missing critical `amount_cents`), AutoPatch dispatches rich Slack Block Kit and Discord cards with:
* Exact field diff summary (`user_id -> id`)
* 5-Gate status & confidence score
* Direct link to auto-generated GitHub PR
* **"Force Approve Rule"** operator override button

### 5. Zero-PII Compliance AI Inference
Raw customer data (emails, credit cards, user IDs, bank balances) is never transmitted to LLM endpoints. Values are masked into structural tokens (`<STRING_EMAIL>`, `<NUMERIC_FLOAT>`, `<NUMBER_INT>`). The AI only observes **keys and data types** to generate mapping rules.

---

## Quickstart

### 1. Install & Setup
```bash
git clone https://github.com/coders-of-bharat/autopatch.git
cd autopatch
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Fill in your Google AI Studio key:
```env
PORT=8080
UPSTREAM_BASE_URL=http://localhost:4000
LLM_MODE=live
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-2.0-flash
PR_ENABLED=false
```

### 3. Start Development Servers
```bash
npm run dev
```
* **Operator Console:** `http://127.0.0.1:8080/console`
* **Startup Landing Page:** `http://127.0.0.1:8080/`
* **Demo Client:** `http://127.0.0.1:8080/demo`
* **Upstream Chaos Mock:** `http://127.0.0.1:4000`

---

## 1-Command CLI Adoption
Any application can place AutoPatch in front of an existing third-party API in one command:
```bash
npx autopatch-proxy --target https://api.stripe.com --port 8080 --mode active
```

---

## Chaos Scenarios & Verification Gates

| Scenario | Drift Description | Outcome |
|---|---|---|
| `none` | Baseline contract | Verified (0.08 ms overhead) |
| `rename` | `user_id` -> `id`, `email` -> `user_email` | Auto-Healed (5/5 Gates Passed) |
| `nest` | `email` -> `contact.email_addr` | Auto-Healed (5/5 Gates Passed) |
| `type_mismatch` | `"450.50"` string balance, `1` int boolean | Auto-Healed with Type Coercion |
| `array_wrap` | Wrapped in `data[0]` | Auto-Healed with Array Indexing |
| `date_shift` | `created_at` epoch seconds -> ISO date | Auto-Healed with Date Coercion |
| `combo_v2` | Renames, nesting, types & dates all at once | Auto-Healed (The Headline Demo) |
| `field_deleted` | Required `email` field deleted | **Blocked at Gate 5 -> 502 Fail-Closed** |

---

## Verification & Testing

```bash
# Run 92 Unit & Integration Tests
npm test

# Run TypeScript Typecheck
npm run build

# Run Smoke Test Across All 8 Scenarios
npm run smoke
```

---

## Built by Team Coders of Bharat
* **Lead Engineer & Architect:** Anirudh Verma
* **Project:** AutoPatch
* **Event:** Google Startup Buildathon India 2026
