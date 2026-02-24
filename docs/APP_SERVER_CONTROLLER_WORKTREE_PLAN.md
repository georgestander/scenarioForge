# APP_SERVER_CONTROLLER_WORKTREE_PLAN

## 1. Objective

Refactor ScenarioForge execute into a durable, controller-driven loop that uses Codex App Server as a harness (not as the scheduler), while preserving the locked external contract:

- Two core actions only: `generate`, `execute`
- Thin public API surface
- Full auditability of run/fix/rerun/PR evidence

This plan removes long-horizon single-turn fragility and introduces deterministic repo execution using per-scenario git worktrees.

## 2. Root Causes (Current Drift)

1. `execute` currently expects one Codex turn to run/fix/rerun/PR for the full scenario pack.
2. One global `cwd` is reused instead of per-repo/per-branch synced workspaces.
3. Bridge JSON-RPC handling treats any `id` message as a response, which can drop server-initiated requests.
4. Timeout handling can continue after incomplete turns and attempt strict JSON parsing on partial output.
5. PR outcomes are not fully deterministic from controller-owned git/PR operations.

## 3. Target Runtime Architecture

### 3.1 Responsibility Split

1. App controller owns loop lifecycle, retries, scenario ordering, state transitions, and durable status.
2. Codex App Server owns bounded reasoning/tool execution inside each turn.
3. Git/GitHub operations that must be deterministic (branch creation, commit, push, PR creation) are controller-owned.

### 3.2 Execution Model

1. One background job per execute intent.
2. Job contains ordered selected scenario IDs.
3. Each scenario runs in a bounded attempt loop.
4. Scenario terminal statuses are `passed` or `failed`.
5. Environment/tooling inability is represented as `failed` with explicit limitation evidence.

## 4. JSON-RPC Compliance Requirements

1. Perform `initialize` / `initialized` handshake once per bridge process.
2. Distinguish message classes correctly:
   - response: `id` + (`result` or `error`)
   - request: `id` + `method` and no `result`
   - notification: `method` and no `id`
3. Handle server-initiated requests:
   - `item/commandExecution/requestApproval`
   - `item/fileChange/requestApproval`
   - `tool/requestUserInput` (if surfaced)
4. Persist and stream `item/*` progress notifications; do not rely only on top-level turn snapshots.
5. Enforce backpressure and retry policy for overload/transient transport errors.

## 5. Workspace and Git Worktree Strategy

### 5.1 Local Storage Layout

1. Bare mirror cache per repo:
   - `.scenarioforge/repos/<owner>__<repo>.git`
2. Worktrees per scenario attempt:
   - `.scenarioforge/worktrees/<projectId>/<jobId>/<scenarioId>/attempt-<n>`

### 5.2 Sync Flow Per Job

1. Resolve repo+branch from project context.
2. Ensure bare mirror exists; if missing clone `--mirror`.
3. Fetch remote before each scenario attempt.
4. Create isolated branch and worktree from `origin/<branch>`.
5. Pass that specific worktree path as `cwd` for scenario turns and checks.

### 5.3 Cleanup and Recovery

1. Cleanup stale worktrees/branches by TTL and terminal job state.
2. Keep enough retention for audit artifacts and rerun evidence.
3. Recover in-progress jobs on process restart by reading durable state.

## 6. Execute Controller State Machine

### 6.1 Job States

1. `queued`
2. `running`
3. `completed`
4. `failed`

### 6.2 Scenario Attempt States

1. `queued`
2. `preparing_workspace`
3. `running_checks`
4. `fixing`
5. `rerunning`
6. `committing`
7. `opening_pr`
8. `passed` or `failed`

### 6.3 Controller Loop (Per Scenario)

1. Prepare isolated worktree.
2. Run bounded validation commands.
3. If pass: record evidence and continue.
4. If fail: run bounded Codex fix turn with scenario-specific context.
5. Rerun impacted checks.
6. Repeat until pass or attempt limit reached.
7. If pass and mode requires PR:
   - commit
   - push
   - open PR
8. Persist terminal scenario status and artifacts.

## 7. Turn Contract Refactor

1. Replace giant execute prompt with per-scenario bounded prompts.
2. Include:
   - scenario card
   - current failure output
   - relevant files/check commands
   - explicit attempt number and limit
3. Keep strict output shape for scenario-local outcomes, not full-pack monolith JSON.
4. If turn times out/fails, mark scenario failed with exact error evidence and continue.

## 8. Parallelism Policy

1. Default: sequential scenario execution for reliability.
2. Optional worker pool when stable:
   - separate worktree per worker/scenario
   - strict concurrency cap
3. Parallel safe zone: read-heavy analysis/exploration.
4. Write operations require isolated workspace and deterministic merge policy.

## 9. API Surface (Unchanged Public Contract)

Public core actions stay:

1. `POST /api/projects/:projectId/actions/generate`
2. `POST /api/projects/:projectId/actions/execute/start`

Job read APIs stay:

1. `GET /api/jobs/:jobId`
2. `GET /api/jobs/:jobId/events`
3. `GET /api/jobs/active`

Internal implementation changes behind these endpoints only.

## 10. Data Model Additions

Add durable attempt-level records:

1. `execution_scenario_attempts`
   - `job_id`, `scenario_id`, `attempt`, `state`, timestamps
   - `worktree_path`, `branch_name`
   - `check_commands`, `check_results`
   - `error_message` (if any)
2. Artifact links:
   - changed files
   - commit SHA
   - PR URL or explicit PR failure reason

## 11. UI Contract Updates

1. Execute screen keeps user-facing scenario state stream (not raw protocol noise by default).
2. Scenario selection supports:
   - select all (default on)
   - per-scenario toggles
3. Scenario row stages reflect controller states.
4. Navigating away does not stop background job.
5. Dashboard reopens active run for the exact project/job context.

## 12. Rollout Plan

### Milestone 1: Bridge Protocol Correctness

1. Fix request/response/notification dispatch.
2. Add approval request handling path.
3. Add timeout failure semantics that never parse partial turns as success payloads.

### Milestone 2: Workspace Manager

1. Add bare mirror + worktree utilities.
2. Add per-project/repo branch sync.
3. Add cleanup and recovery hooks.

### Milestone 3: Controller Loop

1. Implement per-scenario attempt state machine.
2. Integrate bounded Codex turns for fix steps.
3. Persist attempt events and artifact references.

### Milestone 4: Deterministic GitHub PR Path

1. Controller-owned commit/push.
2. Controller-owned PR create.
3. Explicit actionable failure when PR cannot be created.

### Milestone 5: UX and Reliability Hardening

1. Stage-level UI affordance polish.
2. Resume/retry from failed subset without regeneration.
3. End-to-end local reliability runbook.

## 13. Acceptance Criteria

1. Execute no longer depends on one giant full-pack Codex turn.
2. Each scenario reaches terminal `passed` or `failed` state with evidence.
3. Active jobs survive navigation away and can be resumed.
4. Workspaces are isolated per scenario attempt (no cross-scenario write collisions).
5. PR outcomes are deterministic; when unavailable, explicit actionable failure is shown.
6. No synthetic success/failure fabrication.

## 14. Out of Scope

1. New public core action types.
2. Replacing App Server with SDK for this phase.
3. Full production multi-tenant orchestration platform changes.
