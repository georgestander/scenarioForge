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
- Phase 3 scenario generation: implemented.
- Phase 4 run engine + observability: implemented.
- Phase 5 auto-fix + PR creation records: implemented.
- Phase 6 review board + export report: implemented.
- Available now:
  - Full linear workflow UI: connect -> select sources -> generate -> run -> fix -> review.
  - Source inventory scanner with trust scoring (`trusted/suspect/stale/excluded`), deselection, and explicit manifest confirmation.
  - Scenario pack generation grouped by feature and outcome, with contract-complete scenarios + markdown persistence payload.
  - Run engine records with deterministic per-scenario statuses, event timelines, and evidence artifacts.
  - Auto-fix attempt records with root-cause summaries and PR records gated by rerun evidence.
  - Review board aggregation and one-click challenge report export API.
  - Unit + regression suites aligned to the scenario coverage matrix (`npm run test:unit`, `npm run test:regression`).

## Immediate Next Step

Productionize Phase 7 hardening:
1. Replace in-memory state with durable DB/object storage.
2. Integrate real Codex transport streaming and review mode.
3. Replace simulated fix/PR artifacts with real branch commit + PR creation.

## Session Audit Trail

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
