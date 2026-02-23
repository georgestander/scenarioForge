# ScenarioForge Execution Backlog

## Status Legend

- `todo`
- `in_progress`
- `done`
- `blocked`

## Reality Baseline (2026-02-23)

- Completion is tracked against real end-to-end behavior, not simulated artifacts.
- Phase 0 and Phase 1 are complete.
- Phase 2 has partial implementation and remains `in_progress`.
- Phases 3-6 remain outstanding (`todo`) until the real scenario -> run -> fix -> PR loop is operational.

## Phase 0 - Foundation

### SF-0001 Create project shell domain model

- Priority: P0
- Status: done
- Outcome:
  - `Project` entity exists with stable API shape.

### SF-0002 Add in-memory persistence adapter

- Priority: P0
- Status: done
- Outcome:
  - Create/list project and Codex session state within worker runtime.

### SF-0003 Add health and project API routes

- Priority: P0
- Status: done
- Outcome:
  - `GET /api/health`
  - `GET /api/projects`
  - `POST /api/projects`

### SF-0004 Add Codex app-server session skeleton contract

- Priority: P0
- Status: done
- Outcome:
  - `GET /api/codex/sessions`
  - `POST /api/codex/sessions`
  - Initialize and thread-start payload blueprints returned.

### SF-0005 Build Phase 0 shell UI

- Priority: P0
- Status: done
- Outcome:
  - Project create/list from UI.
  - Codex session bootstrap from UI.

## Phase 1 - Auth and Repo Connect

### SF-1001 ChatGPT auth integration

- Priority: P0
- Status: done
- Outcome:
  - Session-backed ChatGPT sign-in/sign-out endpoints implemented.
  - `GET /api/auth/session` exposes live auth state to UI.
  - Phase 1 shell shows signed-in principal status.

### SF-1002 GitHub App auth

- Priority: P0
- Status: done
- Outcome:
  - GitHub App install URL endpoint implemented.
  - Installation connect endpoint exchanges app JWT for installation token.
  - Repository list endpoint and UI repository selector implemented.

### SF-1003 Project ownership checks

- Priority: P1
- Status: done
- Outcome:
  - Project and Codex session APIs now require authenticated principal.
  - Project/session records are owner-scoped per principal.
  - Ownership enforced on create/list/session-init operations.

## Phase 2 - Source Relevance Gate

### SF-2001 Source inventory scanner

- Priority: P0
- Status: in_progress
- Acceptance criteria:
  - Scan source candidates from the connected repository (not hard-coded file lists).
  - Discover and type PRDs/specs/plans/architecture artifacts plus a code inventory baseline.
  - Exclude deselected sources from generation input.

### SF-2002 Relevance scoring

- Priority: P0
- Status: in_progress
- Acceptance criteria:
  - Each discovered source receives `trusted/suspect/stale/excluded` status from real signals.
  - Include recency and doc/code drift signals (symbol/route overlap + contradiction hints).
  - Persist scores and warnings on the source manifest used for generation.

### SF-2003 Source selection UX

- Priority: P0
- Status: in_progress
- Acceptance criteria:
  - User can select/deselect sources and review warnings before generation.
  - Generation is blocked until explicit relevance confirmation is provided.
  - Manifest captures exact selected source IDs and hashes for auditability.

## Phase 3 - Scenario Generation

### SF-3001 Feature/outcome clustering

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Worker API invokes Codex app-server turns for scenario generation.
  - Use `codex spark` with selected sources to generate scenario groups by feature and user outcome.
  - Scenario groups are traceable to selected source IDs/hashes.

### SF-3002 Scenario contract generation

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Generate contract-complete scenarios aligned to the `$scenario` skill quality bar.
  - Include preconditions, steps, expected checkpoints, edge variants, and binary pass criteria.
  - Generate realistic persona-based flows, not static templates.
  - UI only initiates and displays generation; it does not synthesize scenario content.

### SF-3003 Scenarios persistence

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Persist structured scenario JSON and `scenarios.md` with manifest linkage.
  - Persist generation audit metadata (model, thread/turn IDs, repo, branch, head SHA).
  - Expose generated artifacts as downloadable files in the UI.
  - Keep revision history so each run can be traced to the generation artifact used.

## Phase 4 - Run Engine

### SF-4001 Runner orchestration

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Execute selected scenarios against real app/repo context.
  - Track real per-scenario state transitions and rerun impacted scenarios after fixes.

### SF-4002 Evidence capture

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Capture real logs/screenshots/traces/diffs tied to run + scenario IDs.
  - Evidence references resolvable artifacts, not placeholder paths.

### SF-4003 Live progress streaming

- Priority: P1
- Status: todo
- Acceptance criteria:
  - UI streams real queued/running/passed/failed/blocked status updates.
  - Event ordering and timestamps reflect actual runner events.

## Phase 5 - Auto-Fix and PRs

### SF-5001 Failure classifier

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Failure records include observed vs expected mismatch with evidence-backed hypotheses.
  - Classification references concrete failing checkpoints from scenario contracts.

### SF-5002 Fix implementation agent flow

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Use `gpt-5.3-xhigh` to produce real code patches for failed scenarios.
  - Run fix loop until impacted scenarios pass or stop conditions are reached.

### SF-5003 PR creation pipeline

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Create real branches/commits and open GitHub PRs.
  - PR body includes scenario IDs, failure cause, code changes, rerun evidence, and residual risk.

## Phase 6 - Review Board and Reporting

### SF-6001 Review board UI

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Consolidate findings, risks, recommendations, and real PR status from persisted evidence.
  - Highlight unresolved failures and merge-order dependencies.

### SF-6002 Exportable challenge report

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Export report references real run/fix/PR artifacts and source manifests.
  - Report is reproducible for any historical run.

## Immediate Next 5 Tickets

1. `SF-2001` Replace hard-coded source candidates with connected-repo source discovery and typing.
2. `SF-2002` Implement real relevance/staleness scoring using recency + doc/code drift signals.
3. `SF-3001` Integrate `$scenario`-aligned scenario generation and persist `scenarios.md` + JSON outputs.
4. `SF-4001` Implement real scenario execution runner with evidence capture and live event streaming.
5. `SF-5001` Implement real auto-fix loop (patch + rerun gate) and GitHub PR creation.
