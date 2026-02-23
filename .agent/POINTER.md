# ScenarioForge Pointer

Last updated: 2026-02-23

## Project Intent

Ship a full-flow scenario-first quality product for the Codex challenge.

## Current Source of Truth

1. `README.md`
2. `docs/IMPLEMENTATION_PLAN.md`
3. `docs/ARCHITECTURE.md`
4. `docs/EXECUTION_BACKLOG.md`
5. `AGENTS.md`

## Locked Core Decisions

- Frontend stack: RedwoodSDK.
- Orchestration: Codex app-server.
- Auth: ChatGPT sign-in + GitHub integration.
- Source gate: users can select/deselect PRDs/specs/plans and must confirm relevance.
- Scenario research model: `codex spark`.
- Implementation/fix model: `gpt-5.3-xhigh`.

## Phase Status

- Phase 0 foundation: implemented.
- Phase 1 auth + repo connect: implemented.
- Phase 2 source relevance gate: implemented.
- Phase 3 scenario generation: implemented with Codex app-server turn execution and artifact downloads.
- Phase 4 run engine + observability: scaffolded (deterministic simulation still in place).
- Phase 5 auto-fix + PR creation records: scaffolded (deterministic simulation still in place).
- Phase 6 review board + export report: scaffolded on top of current deterministic run/fix/PR records.
- Available now:
  - Full linear workflow UI: connect -> select sources -> generate -> run -> fix -> review.
  - Source inventory scanner with trust scoring (`trusted/suspect/stale/excluded`), deselection, and explicit manifest confirmation.
  - Scenario pack generation executed by Codex app-server (`codex spark`) with skill-first (`$scenario`) invocation and fallback prompt contract.
  - Scenario artifacts persisted as structured pack JSON + `scenarios.md`, including generation audit metadata (thread/turn/model/skill/repo/branch/head SHA).
  - Stage 3 UI download actions for `scenarios.md` and `scenarios.json`.
  - Run engine records with deterministic per-scenario statuses, event timelines, and evidence artifacts.
  - Auto-fix attempt records with root-cause summaries and PR records gated by rerun evidence.
  - Review board aggregation and one-click challenge report export API.
  - Unit + regression suites aligned to the scenario coverage matrix (`npm run test:unit`, `npm run test:regression`).

## Immediate Next Step

Execute Phase 4 with real runner semantics:
1. Replace deterministic run outcomes with real scenario execution against repo/app context.
2. Capture resolvable evidence artifacts (logs/traces/screenshots/diffs) tied to scenario/run IDs.
3. Keep existing review/fix contracts but switch inputs from simulated to real runner output.

## Session Audit Trail

- 2026-02-23: Implemented real Phase 3 generation path through Codex app-server bridge (`/scenario/generate`) with `skills/list` capability check, `$scenario` skill-first invocation, and fallback prompt contract.
- Decision: Scenario packs are now built from Codex turn output (no static blueprints), validated against strict scenario schema, and persisted with generation audit metadata (`threadId`, `turnId`, model, skill availability/path, cwd, repo/branch/head SHA).
- Next action: Replace Phase 4 deterministic run simulation with real execution + evidence capture while preserving current API and UI contracts.
- 2026-02-23: Implemented real Phase 2 source relevance gate against the connected GitHub repository and selected branch, replacing hard-coded source candidates.
- Decision: Source scan now discovers only planning/spec/task docs (`.md/.txt/.json`) from repository tree, computes recency + doc/code alignment signals, flags stale/conflicting selections, and requires explicit confirmation before manifest creation.
- Next action: Wire Phase 3 scenario generation to consume manifest-traceable source docs and produce `scenarios.md` using the scenario skill contract.
- 2026-02-23: Restricted Source Relevance Gate selection inventory to planning artifacts only (`.md/.json/.txt` with planning signals), removing application logic/code files from selectable scan results.
- Decision: Code remains baseline execution context and is no longer user-selectable/deselectable in Stage 2; only planning/task/PRD/spec-oriented documents participate in source manifests.
- Next action: Add a focused UI regression check to ensure source scan lists never include `src/*` or other application logic paths.
- 2026-02-23: Removed same-tab ChatGPT auth fallback so Stage 1 sign-in no longer navigates users away from ScenarioForge when popups are blocked.
- Decision: Sign-in UX must remain in-app; blocked popup state now keeps context and offers explicit "Open ChatGPT Sign-In Tab" + complete/cancel controls.
- Next action: Add a UI regression check to ensure ChatGPT sign-in never triggers same-tab navigation from the core workflow.
- 2026-02-23: Updated local developer startup so `pnpm dev` launches both the app and ChatGPT auth bridge automatically, eliminating the two-terminal requirement for sign-in.
- Decision: Keep `dev:app` and `dev:auth-bridge` available for advanced debugging, but make `dev` the one-command default path.
- Next action: Add a CI/dev smoke check for `pnpm dev` startup orchestration so bridge readiness failures are caught earlier.
- 2026-02-23: Hardened ChatGPT sign-in reliability by adding popup-block fallback (same-tab redirect with login resume), persistent pending-login recovery, and a serialized app-server initialize guard in the auth bridge.
- Decision: Sign-in must progress even when browser popup policy blocks `window.open`; pending login IDs now survive navigation via session storage until completion/cancel.
- Next action: Add a browser-level regression test that covers blocked-popup fallback and resumed sign-in completion after return to app.
- 2026-02-23: Replaced local ChatGPT sign-in stub (manual name/email form) with managed ChatGPT browser login start/complete/cancel flow backed by Codex app-server account auth via bridge endpoints.
- Decision: Identity is now sourced from ChatGPT account state (email) instead of user-entered profile fields; local session is created only after verified ChatGPT auth completion.
- Next action: Replace the temporary HTTP auth bridge with direct app-server transport integration in worker runtime so production deploys do not require a sidecar process.
- 2026-02-23: Home page hero image was constrained to prevent it from dominating the viewport and pushing core UI/forms below the fold.
- Decision: Keep hero art as supporting context only, with bounded card/image height so the primary workflow remains visible on first view.
- Next action: Continue Phase 2 source trust gate work (`SF-2001` to `SF-2003`) on top of the current UI shell.
- 2026-02-23: Replaced the Phase 1 shell panel with a strict 3-step setup wizard (`Sign in -> Connect GitHub -> Create project`) and removed manual GitHub installation ID input from UX.
- Decision: GitHub connect now follows callback-based auto-connect; debug/session payloads moved behind a collapsed `Advanced` section to keep the primary flow clean.
- Next action: Implement real ChatGPT OAuth sign-in (replace current local sign-in stub), then proceed to Phase 2 source trust gate work.
- 2026-02-23: Added model normalization in session storage/listing so all thread start payloads are forced to `gpt-5.3-xhigh`, including legacy in-memory sessions created with `gpt-5.1-codex`.
- Decision: Prevent stale local state from surfacing old model names in Advanced debug output.
- Next action: Keep this enforcement until full persistent storage migration and auth hardening are complete.
- 2026-02-23: Implemented phases 2 through 6 end-to-end with new API contracts, services, UI flow, review export, and validation suites.
- Decision: Keep deterministic in-memory simulation for run/fix/PR evidence in this milestone to ensure auditable contracts while real integrations are phased in next.
- Next action: Start durable persistence and real transport/PR wiring while preserving the established API shapes and scenario evidence model.
