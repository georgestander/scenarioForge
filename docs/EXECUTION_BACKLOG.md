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
- Status: done
- Acceptance criteria:
  - PRDs/specs/plans/code candidates discovered and typed.

### SF-2002 Relevance scoring

- Priority: P0
- Status: done
- Acceptance criteria:
  - Each source receives trusted/suspect/stale status.

### SF-2003 Source selection UX

- Priority: P0
- Status: done
- Acceptance criteria:
  - User can select/deselect sources and confirm relevance before generation.

## Phase 3 - Scenario Generation

### SF-3001 Feature/outcome clustering

- Priority: P0
- Status: done
- Acceptance criteria:
  - Scenarios grouped by feature and user outcome.

### SF-3002 Scenario contract generation

- Priority: P0
- Status: done
- Acceptance criteria:
  - Scenarios include preconditions, steps, expected checkpoints, edge variants, binary pass criteria.

### SF-3003 Scenarios persistence

- Priority: P1
- Status: done
- Acceptance criteria:
  - Scenario packs stored with source manifest references.

## Phase 4 - Run Engine

### SF-4001 Runner orchestration

- Priority: P0
- Status: done
- Acceptance criteria:
  - Run selected scenario sets and track per-scenario status.

### SF-4002 Evidence capture

- Priority: P0
- Status: done
- Acceptance criteria:
  - Logs/screenshots/traces linked to scenario run records.

### SF-4003 Live progress streaming

- Priority: P1
- Status: done
- Acceptance criteria:
  - UI reflects queued/running/passed/failed/blocked in near real time.

## Phase 5 - Auto-Fix and PRs

### SF-5001 Failure classifier

- Priority: P0
- Status: done
- Acceptance criteria:
  - Failure records include probable root-cause summary.

### SF-5002 Fix implementation agent flow

- Priority: P0
- Status: done
- Acceptance criteria:
  - Failed scenarios can trigger model-driven code patches.

### SF-5003 PR creation pipeline

- Priority: P0
- Status: done
- Acceptance criteria:
  - PR contains scenario linkage and rerun evidence.

## Phase 6 - Review Board and Reporting

### SF-6001 Review board UI

- Priority: P0
- Status: done
- Acceptance criteria:
  - Consolidated findings, risks, recommendations, and PR status.

### SF-6002 Exportable challenge report

- Priority: P1
- Status: done
- Acceptance criteria:
  - One-click export summary suitable for challenge submission.

## Immediate Next 5 Tickets

1. `SF-7001` Replace in-memory persistence with durable DB/object storage adapters.
2. `SF-7002` Integrate real Codex app-server transport with streamed turns/review mode.
3. `SF-7003` Wire real fix-to-branch commit + GitHub PR opening flow.
4. `SF-7004` Add run queue retries/backoff and flaky-run heuristics.
5. `SF-7005` Add auth hardening + production observability dashboards.
