# AutoPatch — Decision Log

*Decisions made during the build that deviate from or fill in ambiguity in the spec (`prd.md`). One entry per decision.*

---

## D1 — `src/healer/heal.ts` not created as a separate file

**Spec says:** `src/healer/` should contain a `heal.ts`.  
**Decision:** The heal orchestration logic lives in `engine.ts` (`HealEngine.heal()` and `HealEngine.coldHeal()`). A separate `heal.ts` would be a thin re-export with no additional behaviour. Keeping it in `engine.ts` avoids an unnecessary module boundary.  
**Impact:** None — the external API is `HealEngine.heal()` which is the same contract.

---

## D2 — `src/github/queue.ts` not created as a separate file

**Spec says:** `src/github/` should contain `codegen.ts`, `pr.ts`, and `queue.ts`.  
**Decision:** The queue logic (deduplication, retries, job state) is embedded in `PrQueue` in `pr.ts`. Splitting it into a separate `queue.ts` would have created a circular dependency without meaningful separation of concerns.  
**Impact:** None.

---

## D3 — TypeScript 7.0 is used (spec says "current LTS ≥ 20 Node.js")

**Spec says:** "latest stable of each package, then pin with `npm install --save-exact`."  
**Decision:** TypeScript 7.0.2 is the latest stable at build time and was pinned as installed. Node.js 20+ LTS is the runtime requirement (not the TypeScript version).  
**Impact:** None — TypeScript is a dev-only tool.

---

## D4 — `zod` v4 used for schema validation

**Spec says:** Use Zod.  
**Decision:** Zod 4.6.7 is the installed version. The API is compatible; `z.enum`, `z.object`, `safeParse`, etc. all work as expected. The only difference from Zod v3 is that `z.enum` now accepts a `readonly` tuple directly.  
**Impact:** None.

---

## D5 — Mock mapper coerces `iso_datetime` for plain strings too

**Spec says:** Coercion rules for `iso_datetime` accept an ISO string or epoch number.  
**Decision:** The `MockMapper` always sets `coerce: 'iso_datetime'` for string values in the sanitised structure when the expected type is `iso_datetime`. This is safe — the coercion in `rule.ts` validates and re-serialises ISO strings to UTC, which is a no-op for already-valid ISO-8601 strings.  
**Impact:** Slightly over-eager coercion annotation in mock mode; has no effect on the final output.

---

## D6 — WebSocket heartbeat ping every 30 seconds

**Spec says:** WebSocket live feed.  
**Decision:** A 30-second `ping` interval is added to keep proxies and load balancers from dropping idle WebSocket connections. This is a standard practice and not in conflict with any requirement.  
**Impact:** None.

---

## D7 — `data/rules.json` is populated with pre-warmed rules at first run

**Spec says:** Rules persist to `data/rules.json` on every change and reload on startup.  
**Decision:** The file is generated at runtime by the running servers. It is git-ignored. The `npm run prewarm` script populates it before a demo.  
**Impact:** Fresh clone has no rules until the first heal or prewarm run.

---

## D8 — Gemini SDK `abortSignal` and `httpOptions.timeout` both set for LLM timeout

**Spec says:** Timeout `LLM_TIMEOUT_MS`, one retry on 429/5xx/network errors.  
**Decision:** Both `abortSignal` (via `AbortController`) and `httpOptions.timeout` are set to the same value as a belt-and-suspenders approach. The abort controller fires first if the SDK does not respect `httpOptions.timeout`.  
**Impact:** None — harmless redundancy.

---

## D9 — Generated adapter uses plain JS (not TypeScript) for the `adapterCode`

**Spec says:** Commit `src/adapters/<slug>.ts` (the adapter function plus tiny inline coercion helpers).  
**Decision:** The adapter code uses JSDoc annotations (`@param`, `@returns`) for type hints rather than TypeScript syntax. This means it can be run by `node:test` without a build step, satisfying the spec requirement that the test passes with `npx tsx --test`. The file extension is still `.ts` as required.  
**Impact:** The adapter is not type-checked by `tsc`. This is acceptable for a generated adapter that is always reviewed via PR before merging.

---

## D10 — `console.js` and `demo.js` are plain ES modules (no bundler)

**Spec says:** "Frontend: static HTML + CSS + vanilla JS modules. No build step."  
**Decision:** Both scripts use `type="module"` and are loaded directly by the browser. No Vite, Webpack or esbuild is involved. Tailwind is loaded from the Play CDN fallback embedded in the styles.  
**Impact:** Module imports are not used (single-file scripts). This is consistent with the no-build-step requirement.

---

## D11 — `src/healer/mock-llm.ts` exports `LlmMapper` interface (not in a separate `types` file)

**Spec says:** No specific module layout requirement for the interface.  
**Decision:** `LlmMapper` and `MapperInput` interfaces live in `mock-llm.ts` and are imported by `llm.ts` and `engine.ts`. Moving them to `types.ts` would have caused a circular dependency (`types.ts` → `rule.ts` → `types.ts`).  
**Impact:** None.


---

## D12 — Groq API integration as primary LLM provider

**Spec context:** Spec originally mentioned Google Gen AI (Gemini).  
**Decision:** Integrated Groq's high-speed inference API (`https://api.groq.com/openai/v1/chat/completions`) using native Node.js `fetch` and JSON response formatting (`llama-3.1-8b-instant`). The system prioritizes Groq (`GROQ_API_KEY`) -> Gemini (`GEMINI_API_KEY`) -> Mock fallback.  
**Impact:** Faster cold healing latency with generous free-tier quotas and zero extra dependencies.

---

## D13 — Modern SaaS Tabbed Console UI & Light/Dark Mode

**Spec context:** Spec originally used a sidebar layout and dark-only theme.  
**Decision:** Overhauled Console UI to a modern single-level top navbar layout with animated tab panels (Live Traffic, Chaos Lab, Inspector, Auto-PR), an instant light/dark mode switch persisted in `localStorage`, and beginner-friendly status terminology (e.g., "✓ No Change Needed", "⚡ Auto-Fixed", "✗ Could Not Fix") alongside standard HTTP codes.  
**Impact:** Vastly improved usability and contrast while keeping the exact same WebSocket real-time contracts.


---

## D14 — Dedicated SaaS Startup Home Page at `/`

**Spec context:** Spec originally routed `GET /` as a redirect directly to `/console`.  
**Decision:** Built an interactive, conversion-focused SaaS Home Page at `public/index.html` with its own stylesheet (`public/home.css`). Features include:
- Interactive live drift simulator right on the hero section (toggle between Combo v2, Rename, Nest, Type Mismatch, Array Wrap, and 502 Deleted Field).
- Core value propositions, request lifecycle breakdown, and a traditional vs. AutoPatch comparison table.
- Shared Light / Dark mode switcher persisted via `localStorage`.
- Direct quick-links to the Live Console (`/console`) and Acme Billing Demo (`/demo`).  
**Impact:** Enhances product presentation for demos and pitches without affecting proxy routing.
