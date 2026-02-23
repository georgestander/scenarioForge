# ScenarioForge Execution Backlog

## Status Legend

- `todo`
- `in_progress`
- `done`
- `blocked`

## Reality Baseline (2026-02-23)

- Architecture is now locked to a thin bridge + two actions: `generate`, `execute`.
- UI is intent capture; Codex app-server performs generation and execution logic.
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
  - Surface raw errors and stop reasons clearly.

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

### SF-5003 Raw error visibility

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Preserve Codex/tooling error text in UI and logs.
  - Include correlation metadata for debugging.

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

## Immediate Next 5 Tickets

1. `SF-3001` Implement thin `generate` action endpoint with locked contract.
2. `SF-3002` Implement generation event streaming passthrough.
3. `SF-3004` Add update-scenarios intent path (`mode=update`).
4. `SF-4001` Implement thin `execute` action endpoint with locked contract.
5. `SF-5001` Harden GitHub persistence to remove repeated reconnect prompts.
