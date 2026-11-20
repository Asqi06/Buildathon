# AutoPatch

**Self-healing reverse proxy for silently drifting upstream JSON APIs.**

> Your API provider changed their JSON. Your app never noticed.

AutoPatch sits between your client app and an upstream API. It checks every JSON response against a baseline contract. When the upstream silently changes shape — renamed field, nested object, string instead of number, wrapped array, new date format — AutoPatch asks an LLM for a field-mapping rule, verifies it in code, applies it so the client still receives the shape it expects, caches the rule so later requests heal without an LLM call, and opens a GitHub Pull Request with a permanent adapter and test.

## Why this is real, not a toy

1. **LLM proposes, code applies.** The LLM proposes a mapping rule. Deterministic code applies it. The LLM never writes the response data itself.
2. **Every rule is verified.** Five gates must pass before a rule is cached. If verification fails the proxy returns 502 instead of inventing data.
3. **Every metric is measured.** Latency, LLM call counts, and PR state all come from real runtime events — nothing is hard-coded.

---

## Quick start

```bash
# 1. Clone and install
git clone <your-repo>
cd autopatch
npm install

# 2. Copy env and fill in your keys
cp .env.example .env
# Edit .env — see section below

# 3. Start both servers (mock upstream :4000 + AutoPatch :8080)
npm run dev

# 4. Open the console
open http://127.0.0.1:8080/console
# Open the demo client
open http://127.0.0.1:8080/demo
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | AutoPatch port (default 8080) |
| `UPSTREAM_BASE_URL` | No | Upstream base URL (default http://localhost:4000) |
| `MOCK_UPSTREAM_PORT` | No | Mock upstream port (default 4000) |
| `LLM_MODE` | No | `live` or `mock` (default `mock`) |
| `GEMINI_API_KEY` | For live heals | Google AI Studio API key |
| `GEMINI_MODEL` | For live heals | e.g. `gemini-2.0-flash-exp` |
| `LLM_TIMEOUT_MS` | No | LLM timeout in ms (default 8000) |
| `MIN_CONFIDENCE` | No | Minimum confidence threshold (default 0.7) |
| `PR_ENABLED` | No | `true` to enable GitHub PRs (default `false`) |
| `GITHUB_TOKEN` | For PRs | Fine-grained PAT (Contents + PRs: read/write) |
| `GITHUB_OWNER` | For PRs | GitHub username or org |
| `GITHUB_REPO` | For PRs | Demo repo name |
| `GITHUB_BASE_BRANCH` | No | Base branch (default: repo default branch) |
| `DATA_DIR` | No | Rule cache directory (default `./data`) |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start mock upstream + AutoPatch in watch mode |
| `npm run dev:proxy` | Start AutoPatch only |
| `npm run dev:mock` | Start mock upstream only |
| `npm run build` | TypeScript type-check (`tsc --noEmit`) |
| `npm test` | Run all Vitest unit tests |
| `npm run smoke` | Run smoke script (all 8 chaos modes) |
| `npm run prewarm` | Pre-warm the rule cache for all heal scenarios |

## Chaos scenarios

| Mode | What changes | Expected outcome |
|---|---|---|
| `none` | Baseline | VERIFIED |
| `rename` | `user_id` → `id`, `email` → `user_email` | AUTO-HEALED |
| `nest` | `email` → `contact.email_addr` | AUTO-HEALED |
| `type_mismatch` | `account_balance` is `"450.50"`, `is_verified` is `1` | AUTO-HEALED |
| `array_wrap` | Payload wrapped in `{data: [baseline]}` | AUTO-HEALED |
| `date_shift` | `created_at` becomes epoch seconds | AUTO-HEALED |
| `combo_v2` | All changes at once — the headline demo | AUTO-HEALED |
| `field_deleted` | `email` removed entirely | 502 UNRECOVERABLE |

## Architecture

```
[Acme Billing] → [AutoPatch :8080] → [Mock upstream :4000]
                       |
  contract match? → no  → passthrough
                  → yes → validate 2xx JSON
       valid → return (VERIFIED)
       invalid → fingerprint → cache hit  → apply rule → return (AUTO-HEALED cached)
                             → cache miss → sanitise → LLM → verify → apply → cache → return (AUTO-HEALED)
                                                                       └→ async PR worker → GitHub
       failure → 502 UNRECOVERABLE
Every event → WebSocket → Console UI
```

## Ports and routes

- `:8080` — AutoPatch. Proxy: `/api/*`. UI: `/console`, `/demo`. Internal: `/__autopatch/*`.
- `:4000` — Mock upstream. Endpoint: `GET /api/v1/checkout/user`. Control: `GET|POST /__control/chaos`.

## Honest limits

AutoPatch heals **structural** drift, not meaning changes. It needs a baseline contract per endpoint. Mappings are inferred — production use should start in shadow mode and always go through PR review before merging.

## Project structure

```
contracts/      baseline contract JSON
data/           generated rule cache (git-ignored)
public/         static UI (console.html, demo.html, app JS/CSS, vendor fonts)
scripts/        dev runner, prewarm, smoke test
src/
  server.ts     Fastify server entry point
  config.ts     env config (Zod)
  metrics.ts    runtime metrics store
  events.ts     WebSocket event hub
  types.ts      shared TypeScript types
  proxy/        request forwarding and proxy handler
  contracts/    registry and Zod validator
  healer/       fingerprint, sanitizer, LLM mapper, rule engine, cache
  github/       code generator, Octokit PR queue
  mock-upstream/ local chaos server
test/           Vitest unit and integration tests
```
