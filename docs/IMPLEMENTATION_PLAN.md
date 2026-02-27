# ScenarioForge Implementation Plan

## 1. Vision

ScenarioForge is an intent-driven scenario quality system:
- user clicks intent in UI,
- Codex app-server performs generation or execution work in repo context,
- bridge streams progress and persists auditable artifacts.
- signed-in users can return to a dashboard of historical projects/runs and act on them (download/rerun).

Primary outcome:
- turn source-aware scenario validation into a repeatable run -> fix -> PR loop.

## 2. Locked Architecture Decisions

1. Keep the bridge thin.
2. Keep only two core server actions:
- `generate`
- `execute`
3. UI is intent capture and stream rendering, not orchestration.
4. Codex app-server is the execution engine.
5. Return raw errors from Codex/tooling without rewriting root cause.

## 3. Responsibility Boundaries

### 3.1 UI (RedwoodSDK)

UI owns:
- auth and repo connect flows,
- signed-in dashboard (projects, historical runs, artifacts),
- source selection and explicit trust confirmation,
- intent capture (`generate` initial/update, `execute`),
- streaming display and review surfaces.

UI does not own:
- scenario synthesis logic,
- execution/fix/PR orchestration logic.

### 3.2 Bridge (Worker API)

Bridge owns:
- request validation,
- auth and project ownership checks,
- calling Codex app-server turns,
- streaming event passthrough,
- persistence of manifests/packs/runs/evidence references.

Bridge does not own:
- multi-step custom decision trees,
- custom scenario or fix planner logic.

### 3.3 Codex App-Server

Codex owns:
- source synthesis and scenario generation,
- scenario execution loop,
- failure analysis and fix implementation,
- rerun gating,
- PR preparation and authoring output.

## 4. Action Contracts

## 4.1 `generate`

Purpose:
- create initial scenarios or update existing scenario packs based on user intent.

Request:
- `projectId` (string)
- `repo` (string)
- `branch` (string)
- `sourceManifestId` (string)
- `mode` (`initial` | `update`)
- `userInstruction` (string, optional)

Behavior:
1. Verify manifest exists and belongs to project owner.
2. Require a persisted code baseline snapshot (route/API/state/entity/integration/error map) tied to the manifest.
3. Start Codex turn with code-first priority; selected docs are optional secondary context.
4. Apply `$scenario` quality bar with coverage-completeness closure (not fixed count targets).
5. Validate generated output server-side for coverage completeness before persistence.
6. Persist scenario JSON + `scenarios.md` + audit metadata.

Output:
- `scenarioPackId`
- `revision`
- artifact references
- stream events

## 4.2 `execute`

Purpose:
- run scenario loop in repo context and produce evidence-backed PR outcomes.

Request:
- `projectId` (string)
- `repo` (string)
- `branch` (string)
- `scenarioPackId` (string)
- `executionMode` (`run` | `fix` | `pr` | `full`)
- `constraints` (object, optional)

Behavior:
1. Start Codex turn with repo-capable tools.
2. Run PR automation readiness preflight (repo/branch access, push/branch/PR capability, bridge config).
3. Block `executionMode=full` when readiness is not green and return explicit remediation.
4. Execute selected scenarios with per-scenario streaming updates until each scenario reaches a terminal state (`passed` | `failed`).
5. For failures, implement targeted fixes.
6. Rerun impacted scenarios.
7. Prepare PR artifacts and evidence payloads.
8. For full mode failures, return either a real PR URL or explicit manual handoff details (branch + actionable steps).

Output:
- `runId`
- status summary
- evidence references
- PR records (if produced)
- stream events

## 4.3 `execute` Background Job Surface (MVP)

Purpose:
- decouple execution lifecycle from a single live page request.
- allow fire-and-forget run launch, tab close/switch, and later resume.

Job launch request:
- `POST /api/projects/:projectId/actions/execute/start`
- body: `scenarioPackId`, `executionMode`, `userInstruction?`, `constraints?`

Job read surfaces:
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/events?cursor=...&limit=...`
- `GET /api/jobs/active`

Behavior:
1. `start` validates project/pack ownership and active-job cap per owner.
2. `start` persists a queued execution job record and returns immediately with `jobId`.
3. server-side runner uses `waitUntil` to execute Codex in the background.
4. every status/progress/codex event is persisted to job-event storage.
5. final run/fix/pr artifacts are linked back to the job record.
6. job record captures execution audit (`threadId`, `turnId`, model, turn status).

Output:
- `start`: queued `job` + active count metadata.
- `job`: execution status + linked run/fix/pr artifacts.
- `events`: ordered event rows + resumable cursor.

## 5. Streaming Contract

Use server-sent events (or equivalent stream) from bridge to UI.

Event envelope:
- `eventId`
- `action` (`generate` | `execute`)
- `phase` (for UI display)
- `status` (`queued` | `running` | `passed` | `failed` | `blocked` | `complete`)
- `message`
- `payload` (typed object)
- `timestamp`

No fake progress. Emit only real step transitions.

## 6. Error Contract

Raw passthrough principle:
- preserve Codex/tooling error message and type,
- include optional bridge context (`projectId`, `action`, `turnId`) without mutating root cause,
- persist error with timestamp and request correlation ID.

## 7. Source Trust Gate (Mandatory)

Before `generate`:
1. scan repo planning/spec/task docs,
2. score `trusted/suspect/stale/excluded`,
3. build required code baseline snapshot from repository behavior (routes, APIs, transitions, entities, integrations, errors),
4. let user select/deselect docs as optional context,
5. allow zero selected docs (code-only mode) with explicit user confirmation,
6. require explicit confirmation when stale/conflicting docs are selected,
7. persist manifest hash, code baseline identity/hash, and selected source IDs.

## 8. Scenario Quality Standard

Every generated scenario must include:
- scenario ID,
- persona and objective,
- journey and risk intent,
- preconditions/test data,
- realistic end-to-end steps,
- expected checkpoints,
- edge variants,
- code evidence anchors (and optional doc source refs),
- binary pass criteria.

Generated pack must also include coverage summary:
- personas,
- journeys,
- edge buckets,
- features,
- outcomes,
- assumptions,
- known unknowns,
- uncovered gaps.

Group scenarios by:
- feature area,
- user outcome.

## 9. Auth and Persistence

### 9.1 ChatGPT Sign-In

- Session-backed user identity for project ownership and audit records.

### 9.2 GitHub Connection

- One-time connect per user/account intent.
- Reconnect only when token is expired, revoked, or installation changed.
- Persist installation context and refresh token state.

### 9.3 Auditability

Persist and link:
- manifest hash,
- scenario pack revision,
- run and fix attempts,
- evidence artifact references,
- PR linkage to scenario IDs.

## 10. Delivery Phases

### Phase 1 (Done)
- ChatGPT sign-in, GitHub connect, project ownership.

### Phase 2 (In Progress)
- Source scan, relevance scoring, confirmation gate, manifest persistence.

### Phase 3
- `generate` action contract + streaming + scenario artifact persistence.
- Support both `initial` and `update` modes.

### Phase 4
- `execute` action contract + streaming.
- Run/fix/rerun/PR flow with evidence capture.
- Implement app-owned execute controller loop (scenario-by-scenario) with isolated git worktrees per scenario attempt.
- Keep App Server as harness for bounded turns; controller owns scheduling, retries, and terminal status progression.

### Phase 5
- UX hardening: affordances, retries, error visibility.
- GitHub persistence and reconnect experience hardening.

### Phase 6
- Review board and export artifacts from real persisted evidence.

### Phase 7
- Signed-in dashboard with historical projects/runs, artifact downloads, and rerun intents.

## 11. UI Blueprint (Locked for Implementation)

This section is the execution blueprint for the UI overhaul from the reference screens (`docs/ui_images/1` through `7`) plus a new dashboard.

### 11.1 Route Map

- `/` -> Home (marketing + ChatGPT sign-in)
- `/dashboard` -> signed-in user dashboard
- `/projects/:projectId/connect` -> repo/branch connect screen
- `/projects/:projectId/sources` -> source trust gate
- `/projects/:projectId/generate` -> scenario build stream
- `/projects/:projectId/review` -> scenario review and approval
- `/projects/:projectId/execute` -> scenario run stream
- `/projects/:projectId/completed` -> completed summary, PRs, export

### 11.2 Screen Contracts

1. Home (`1_Home`)
- Purpose: establish product value and start auth.
- Primary CTA: `Sign-in with ChatGPT`.
- Required states: signed-out only; signed-in redirects to `/dashboard`.

2. GitHub/Project Connect (`2_Github`)
- Purpose: connect GitHub once, select repo/branch, create/open project context.
- Primary CTA: `Connect with GitHub`, then `Next`.
- Required states: connected identity banner, repo/branch loading, validation errors, disabled next until valid project context.

3. Sources (`3_Sources`)
- Purpose: trust gate before generation.
- Primary CTA: `Create scenarios`.
- Required states:
  - source list from selected repo/branch docs,
  - trust labels (`trusted/suspect/stale/excluded`) with reasons,
  - select/deselect behavior,
  - optional zero-doc path that enables code-only generation,
  - explicit confirmation modal for stale/conflicting selections,
  - PR automation readiness panel and check action,
  - persisted manifest ID/hash tied to selection.

4. Scenario Build (`4_Scenario Build`)
- Purpose: run `generate` and show live progress.
- Primary CTA: none while running; continue on completion.
- Required states:
  - line-by-line human-readable stream (not raw protocol event names),
  - generation status transitions (`queued/running/complete/failed/blocked`),
  - generated scenario checklist (one row per scenario) that updates as each item is persisted,
  - coverage closure summary with unresolved gaps highlighted,
  - emitted artifact notices (`scenarios.md`, scenario JSON pack revision).

5. Scenario Review (`5_Scenario Review`)
- Purpose: review generated scenarios before execution.
- Primary CTA: `Run`.
- Required states:
  - grouped summaries by feature/outcome,
  - scenario count and revision metadata,
  - coverage panel (covered buckets, assumptions, known unknowns, uncovered gaps),
  - download artifacts (markdown + JSON),
  - optional `Update scenarios` intent with user instruction,
  - `Run` disabled while required coverage gaps remain unresolved.

6. Scenario Run (`6_Scenario Run`)
- Purpose: run `execute` loop and stream evidence.
- Primary CTA: none while running; continue to completed view.
- Required states:
  - live stream of high-signal run/fix/rerun/PR steps,
  - execution mode selector with `full` gated by readiness,
  - scenario selection controls (select-all default on, per-scenario toggle),
  - current scenario row is visually highlighted while running,
  - per-scenario checklist board with scenario IDs, checklist state, and current run/fix/rerun/PR stage,
  - hard-fail visibility for real errors and stop reasons.

7. Completed (`7_Completed`)
- Purpose: summarize results and expose next actions.
- Primary CTA: `Back to Dashboard` and `Export report`.
- Required states:
  - real run summary (`passed/failed/blocked`),
  - scenario-level checks with expected/observed evidence,
  - unresolved risks and recommendations,
  - PR cards with real URLs or manual handoff details when blocked,
  - downloadable markdown report bundle with scenario checks and PR linkage/handoff details.

8. Dashboard (new)
- Purpose: signed-in home for returning users.
- Primary CTA: `New Project`.
- Required states:
  - list of historical projects with repo, branch, latest run status, last activity,
  - quick actions: open project, download latest artifacts, rerun generate, rerun execute,
  - project detail panel with scenario revisions and run history,
  - empty state for first-time users.

### 11.3 Dashboard Data Requirements

Bridge/UI read surfaces must support:
- project index by signed-in principal,
- latest scenario pack per project (plus revision history),
- run history with summary stats and timestamps,
- artifact pointers for download (scenario markdown/json, reports, evidence bundles),
- rerun intents that call existing core actions (`generate`, `execute`) with prefilled context.

No additional core action types are introduced; dashboard reruns invoke existing action contracts.

### 11.4 Claude Execution Sequence (UI Overhaul)

1. Build shared app shell:
- header identity, repo/branch context, left phase rail, top progress bar, action footer.

2. Implement route flow from Home -> Connect -> Sources -> Build -> Review -> Run -> Completed:
- each screen wired to real state transitions and loading/error affordances.

3. Implement stream rendering adapters:
- convert raw bridge events into readable timeline lines while preserving raw errors.

4. Implement dashboard and historical retrieval:
- projects list, project detail, artifacts table, run history.

5. Implement dashboard quick actions:
- download artifacts, rerun generate (`initial/update`), rerun execute (`run/fix/pr/full`).

6. Harden UX and quality:
- no dead buttons,
- clear disabled/loading/retry states,
- no placeholder PR/evidence records,
- mobile and desktop usability checks.

### 11.5 Phase 3/4 UI Hard Gates (Required)

Normative contract:
- `docs/STREAM_EXECUTION_UI_CONTRACT.md`

Required for acceptance:
1. Scenario checklist rows are event-driven and keyed by real `scenarioId`.
2. Generate checklist updates show per-scenario progression as generation persists artifacts.
3. Execute checklist updates show stage progression (`run` -> `fix` -> `rerun` -> `pr`) and latest event text.
4. Missing required stream shape (for example missing `scenarioId` on scenario-level updates) triggers explicit action failure diagnostics; UI must not create synthetic rows.
5. Route guards follow server-authoritative prerequisites for `/connect`, `/sources`, `/generate`, `/review`, `/execute`, `/completed`.
6. Raw errors from Codex/tooling remain visible and unmasked in stream and board detail surfaces.
7. `executionMode=full` is blocked server-side when PR readiness is not green.
8. Full-mode failures produce PR outcomes with URL or explicit blocked handoff details.
9. Completed export includes per-scenario checks and PR URL/handoff details from persisted run evidence.

## 12. Execute Controller Addendum (2026-02-24)

The execute implementation is now explicitly aligned to a controller-driven architecture:

1. The app owns the loop and scenario scheduling.
2. Codex App Server is used for bounded turns and event streaming, not infinite-loop orchestration.
3. Scenario writes run in isolated git worktrees (per scenario attempt) to prevent cross-scenario collisions.
4. Public API surface remains unchanged (`generate`, `execute` plus job-read endpoints).

Detailed implementation and patch order are defined in:

- `docs/APP_SERVER_CONTROLLER_WORKTREE_PLAN.md`

## 13. Definition of Done (Current Alignment)

1. `generate` works end-to-end with source gate and stream updates.
2. `generate(mode=update)` revises scenario packs from user intent.
3. `execute` works end-to-end with real loop and PR evidence.
4. GitHub reconnect is not repeatedly required during normal use.
5. Errors are visible, raw, and traceable.
6. UI matches locked screen flow with readable stream feedback.
7. Signed-in dashboard supports historical project recovery, artifact download, and rerun intents.
8. Phase 3/4 checklist and route behavior satisfies `docs/STREAM_EXECUTION_UI_CONTRACT.md`.

## 14. Session Update (2026-02-24)

Decisions made:
1. Bridge JSON-RPC dispatch is fail-safe and protocol-correct:
- server requests (`id + method`) are handled separately from responses (`id + result/error`),
- approval requests are auto-accepted for the session in non-interactive bridge mode,
- unsupported interactive user-input requests fail explicitly instead of deadlocking.
2. Turn timeout handling is fail-closed:
- turns that do not reach terminal completion now return explicit errors,
- partial/in-flight turn reads are no longer treated as successful completions.
3. Execute controller now runs scenario-by-scenario in background jobs:
- each selected scenario is executed in sequence with its own bounded Codex turn,
- one scenario failure no longer blocks later scenarios from running,
- final scenario run is aggregated from real per-scenario terminal outcomes.
4. User-facing outcome policy was tightened:
- scenario terminal states are surfaced as `passed` or `failed`,
- prior `blocked` display state is normalized into explicit failed limitations.

Current implementation status:
1. Milestone 1 (bridge protocol correctness) is implemented.
2. Milestone 3 core controller behavior (per-scenario loop progression) is implemented without changing the public API surface.
3. UI status affordance now aligns with terminal `passed|failed` expectations and keeps background-run resume semantics.

Next actions:
1. Implement repository/worktree isolation layer from `docs/APP_SERVER_CONTROLLER_WORKTREE_PLAN.md` Milestone 2.
2. Add deterministic controller-owned commit/push/PR operations (Milestone 4), then tighten PR-readiness messaging around actionable remediation.
3. Expand regression coverage for per-scenario controller retries and rerun-failed subset determinism.

## 15. Session Update (2026-02-27)

Decisions made:
1. `thread/start.sandbox` uses kebab-case values (`read-only`, `workspace-write`, `danger-full-access`) and bridge normalizes legacy camelCase aliases (`readOnly`, `workspaceWrite`, `dangerFullAccess`) to those RPC-safe values.
2. `turn/start.sandboxPolicy.type` remains camelCase (`readOnly`, `workspaceWrite`) and is passed through unchanged.
3. Execute output schema no longer forces exact `run.items` cardinality and no longer hard-codes `summary.blocked = 0`.
4. Execute output schema now accepts `run.items[].status = blocked`; server normalization maps `blocked` to explicit `failed` limitation outcomes for user-facing consistency.
5. Execute controller retries for the same scenario now reuse a single Codex thread via `threadId`, while keeping each attempt as a bounded turn.
6. Phase 3 generation now auto-starts initial scenario generation when no pack exists, removing the extra click after entering Generate.
7. Full execute mode is now server-gated by PR readiness (`ready` required) before launch, with explicit remediation details returned on failure.
8. Execute PR outputs are now treated as proposal metadata: URL is optional, manual-handoff entries are accepted, and missing real PR URLs no longer fail runs/jobs by default.
9. PR readiness contract now includes first-class actuator and diagnostics fields: `fullPrActuator`, `reasonCodes[]`, `probeResults[]`, and `probeDurationMs`.
10. PR readiness probes now record step-level pass/fail details for deterministic UI gating and blocker telemetry.

Current implementation status:
1. Generate/execute action requests send RPC-safe kebab-case thread sandbox values.
2. Bridge supports optional `threadId` reuse and continues emitting thread/turn audit metadata.
3. Per-scenario execution loop reuses the same thread across retry attempts for that scenario.
4. Generate page triggers initial generation automatically on first load when a manifest exists but no scenario packs are present.
5. `/actions/execute/start` and `/actions/execute` block `executionMode=full` when PR readiness is not green.
6. Execute persistence accepts PR/manual-handoff metadata without requiring Codex to return a real PR URL.
7. PR readiness persistence and hydration now store actuator path, machine-readable reason codes, probe results, and probe duration.
8. Readiness refresh now includes explicit `codex_account` probe status (`CODEX_ACCOUNT_NOT_AUTHENTICATED` when signed out).

Next actions:
1. Add targeted unit/regression coverage for thread reuse behavior and schema acceptance of `blocked`.
2. Continue Milestone 2 worktree isolation to complete per-scenario workspace determinism.
3. Ship PR B UI updates to gate `full` mode by `fullPrActuator` + `reasonCodes` with a probe-details drawer.
