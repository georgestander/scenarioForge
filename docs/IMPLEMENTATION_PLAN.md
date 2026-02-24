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
2. Start Codex turn using selected sources, or code-only mode when no docs are selected.
3. Apply `$scenario` quality bar.
4. Persist scenario JSON + `scenarios.md` + audit metadata.

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
4. Execute selected scenarios with per-scenario streaming updates until each scenario reaches a terminal state (`passed` | `failed` | `blocked`).
5. For failures, implement targeted fixes.
6. Rerun impacted scenarios.
7. Prepare PR artifacts and evidence payloads.
8. For full mode failures, return either a real PR URL or blocked manual handoff details (branch + actionable steps).

Output:
- `runId`
- status summary
- evidence references
- PR records (if produced)
- stream events

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
3. let user select/deselect,
4. allow zero selected docs (code-only mode) with explicit user confirmation,
5. require explicit confirmation when stale/conflicting docs are selected,
6. persist manifest hash and selected source IDs.

## 8. Scenario Quality Standard

Every generated scenario must include:
- scenario ID,
- persona and objective,
- preconditions/test data,
- realistic end-to-end steps,
- expected checkpoints,
- edge variants,
- binary pass criteria.

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
  - emitted artifact notices (`scenarios.md`, scenario JSON pack revision).

5. Scenario Review (`5_Scenario Review`)
- Purpose: review generated scenarios before execution.
- Primary CTA: `Run`.
- Required states:
  - grouped summaries by feature/outcome,
  - scenario count and revision metadata,
  - download artifacts (markdown + JSON),
  - optional `Update scenarios` intent with user instruction.

6. Scenario Run (`6_Scenario Run`)
- Purpose: run `execute` loop and stream evidence.
- Primary CTA: none while running; continue to completed view.
- Required states:
  - live stream of high-signal run/fix/rerun/PR steps,
  - execution mode selector with `full` gated by readiness,
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

## 12. Definition of Done (Current Alignment)

1. `generate` works end-to-end with source gate and stream updates.
2. `generate(mode=update)` revises scenario packs from user intent.
3. `execute` works end-to-end with real loop and PR evidence.
4. GitHub reconnect is not repeatedly required during normal use.
5. Errors are visible, raw, and traceable.
6. UI matches locked screen flow with readable stream feedback.
7. Signed-in dashboard supports historical project recovery, artifact download, and rerun intents.
8. Phase 3/4 checklist and route behavior satisfies `docs/STREAM_EXECUTION_UI_CONTRACT.md`.
