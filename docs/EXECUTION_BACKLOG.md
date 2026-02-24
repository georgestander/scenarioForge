# ScenarioForge Execution Backlog

## Status Legend

- `todo`
- `in_progress`
- `done`
- `blocked`

## Reality Baseline (2026-02-24)

- Architecture is now locked to a thin bridge + two actions: `generate`, `execute`.
- UI is intent capture; Codex app-server performs generation and execution logic.
- UI is being overhauled to the locked 1->7 flow plus a signed-in dashboard.
- Phase 1 is complete.
- Phase 2 is partially complete and remains `in_progress`.

## Phase 1 - Auth and Repo Connect (Done)

### SF-1001 ChatGPT auth integration

- Priority: P0
- Status: done
- Outcome:
  - Session-backed ChatGPT sign-in/sign-out.
  - Auth session endpoint consumed by UI.

### SF-1002 GitHub App auth and repo list

- Priority: P0
- Status: done
- Outcome:
  - Install/connect flow and repository listing.

### SF-1003 Ownership and access checks

- Priority: P1
- Status: done
- Outcome:
  - Project ownership enforced for authenticated principal.

## Phase 2 - Source Trust Gate (In Progress)

### SF-2001 Connected-repo source scanner

- Priority: P0
- Status: in_progress
- Acceptance criteria:
  - Scan planning/spec/task docs from connected repo and selected branch.
  - Classify artifacts by type and include code inventory baseline.

### SF-2002 Relevance and staleness scoring

- Priority: P0
- Status: in_progress
- Acceptance criteria:
  - Assign `trusted/suspect/stale/excluded` using recency + drift signals.
  - Persist warnings and reasons on manifest records.

### SF-2003 Explicit confirmation gate

- Priority: P0
- Status: in_progress
- Acceptance criteria:
  - User can select/deselect sources before generation.
  - Risky selections require explicit confirmation.
  - Persist selected source IDs + hash for auditability.

## Phase 3 - `generate` Action

### SF-3001 Thin bridge `generate` endpoint

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Add a single generate action endpoint.
  - Inputs: `projectId`, `repo`, `branch`, `sourceManifestId`, `mode`, `userInstruction?`.
  - No custom orchestration logic beyond validation + pass-through.

### SF-3002 Codex stream passthrough for generation

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Relay real Codex turn events to UI in order.
  - Include action-scoped event envelopes.
  - UI receives readable timeline lines (not raw protocol event names).

### SF-3003 Scenario artifact persistence and revisioning

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Persist structured scenario JSON and `scenarios.md`.
  - Preserve revisions for `mode=update`.
  - Persist model/turn/repo/branch/head metadata.

### SF-3004 Update-scenarios intent UX

- Priority: P1
- Status: todo
- Acceptance criteria:
  - UI supports `Generate` and `Update` intent paths.
  - `mode=update` includes optional user instruction.

### SF-3005 Scenario build + review screens (locked UX)

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Implement `Scenario Build` and `Scenario Review` screens from locked blueprint.
  - Review shows grouped scenario summaries by feature/outcome.
  - Build screen renders generated scenarios as a checklist and marks each scenario as pending/running/succeeded/failed as generation progresses.
  - Review supports artifact downloads and explicit transition to execute.

## Phase 4 - `execute` Action

### SF-4001 Thin bridge `execute` endpoint

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Add a single execute action endpoint.
  - Inputs: `projectId`, `repo`, `branch`, `scenarioPackId`, `executionMode`, `constraints?`.
  - No custom server loop logic beyond validation + pass-through.

### SF-4002 Execute loop with evidence capture

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Codex executes run/fix/rerun/PR flow with repo tools.
  - Persist evidence references by scenario/run IDs.

### SF-4003 Live execution stream

- Priority: P1
- Status: todo
- Acceptance criteria:
  - UI displays real queued/running/passed/failed/blocked transitions.
  - Run board shows per-scenario checklist rows with live update of current attempt/run stage and latest Codex stream event.
  - Surface raw errors and stop reasons clearly.

### SF-4004 Scenario run board integrity

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Per-scenario board uses only real execute output items.
  - No synthetic blocked rows when structured run data is missing.
  - Missing execute shape produces explicit action failure diagnostics.

## Phase 5 - Reliability and UX Hardening

### SF-5001 GitHub persistence hardening

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Avoid repeated reconnect prompts on normal restarts.
  - Reconnect only on expiry/revocation/installation change.

### SF-5002 Action affordances and retry UX

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Clear loading/progress affordance for scan/generate/execute actions.
  - Explicit retry/resume behavior after action failures.
  - No dead clicks for scan/generate/execute on desktop/mobile.

### SF-5003 Raw error visibility

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Preserve Codex/tooling error text in UI and logs.
  - Include correlation metadata for debugging.
  - Do not mask root-cause schema/shape failures behind generic fallback copy.

## Phase 6 - Review and Reporting

### SF-6001 Review board from persisted evidence

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Build review board using real run/fix/PR artifacts.
  - Highlight unresolved failures and dependency risks.

### SF-6002 Exportable report

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Export report with manifest, scenario, run, and PR linkage.
  - Reproducible for historical runs.

## Phase 7 - Signed-In Dashboard + Historical Recovery

### SF-7001 Dashboard project index

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Signed-in users land on dashboard showing prior projects.
  - Each project row shows repo, branch, latest run status, last activity timestamp.
  - Supports empty/loading/error states.

### SF-7002 Project history detail panel

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Show scenario pack revision history and run history for selected project.
  - Show run summaries (`passed/failed/blocked`) and linked evidence references.
  - Show associated PR records with real URLs only.

### SF-7003 Artifact download center

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Download historical artifacts: `scenarios.md`, scenario JSON, run/report bundles.
  - Downloads are scoped to user-owned projects and selected revisions/runs.
  - Missing artifacts surface clear errors.

### SF-7004 Rerun intents from dashboard

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Dashboard actions can rerun `generate` (`initial`/`update`) and `execute` (`run`/`fix`/`pr`/`full`) for a selected project context.
  - Reruns call existing core action endpoints only.
  - Rerun requests stream to same UI timeline components as in primary flow.

### SF-7005 Navigation + continuity

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Completed screen links cleanly back to dashboard.
  - User can reopen any past project and resume from review or execute steps.
  - Route guards enforce sign-in and ownership boundaries.

## Immediate Next 5 Tickets

1. `SF-3002` Implement generation stream adapter to readable timeline lines.
2. `SF-4004` Enforce real execute output integrity (no synthetic scenario statuses).
3. `SF-3005` Ship locked `Scenario Build` + `Scenario Review` screens.
4. `SF-7001` Build signed-in dashboard project index.
5. `SF-7004` Wire dashboard rerun intents to existing `generate`/`execute` actions.
