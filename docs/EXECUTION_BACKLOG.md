# ScenarioForge Execution Backlog

## Status Legend

- `todo`
- `in_progress`
- `done`
- `blocked`

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
- Status: todo
- Acceptance criteria:
  - User can authenticate with ChatGPT and see session status in app.

### SF-1002 GitHub App auth

- Priority: P0
- Status: todo
- Acceptance criteria:
  - User can connect GitHub and select repository.

### SF-1003 Project ownership checks

- Priority: P1
- Status: todo
- Acceptance criteria:
  - API enforces project/session access by signed-in principal.

## Phase 2 - Source Relevance Gate

### SF-2001 Source inventory scanner

- Priority: P0
- Status: todo
- Acceptance criteria:
  - PRDs/specs/plans/code candidates discovered and typed.

### SF-2002 Relevance scoring

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Each source receives trusted/suspect/stale status.

### SF-2003 Source selection UX

- Priority: P0
- Status: todo
- Acceptance criteria:
  - User can select/deselect sources and confirm relevance before generation.

## Phase 3 - Scenario Generation

### SF-3001 Feature/outcome clustering

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Scenarios grouped by feature and user outcome.

### SF-3002 Scenario contract generation

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Scenarios include preconditions, steps, expected checkpoints, edge variants, binary pass criteria.

### SF-3003 Scenarios persistence

- Priority: P1
- Status: todo
- Acceptance criteria:
  - Scenario packs stored with source manifest references.

## Phase 4 - Run Engine

### SF-4001 Runner orchestration

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Run selected scenario sets and track per-scenario status.

### SF-4002 Evidence capture

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Logs/screenshots/traces linked to scenario run records.

### SF-4003 Live progress streaming

- Priority: P1
- Status: todo
- Acceptance criteria:
  - UI reflects queued/running/passed/failed/blocked in near real time.

## Phase 5 - Auto-Fix and PRs

### SF-5001 Failure classifier

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Failure records include probable root-cause summary.

### SF-5002 Fix implementation agent flow

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Failed scenarios can trigger model-driven code patches.

### SF-5003 PR creation pipeline

- Priority: P0
- Status: todo
- Acceptance criteria:
  - PR contains scenario linkage and rerun evidence.

## Phase 6 - Review Board and Reporting

### SF-6001 Review board UI

- Priority: P0
- Status: todo
- Acceptance criteria:
  - Consolidated findings, risks, recommendations, and PR status.

### SF-6002 Exportable challenge report

- Priority: P1
- Status: todo
- Acceptance criteria:
  - One-click export summary suitable for challenge submission.

## Immediate Next 5 Tickets

1. `SF-1001` ChatGPT auth integration.
2. `SF-1002` GitHub App auth.
3. `SF-2001` Source inventory scanner.
4. `SF-2002` Relevance scoring.
5. `SF-2003` Source selection UX.
