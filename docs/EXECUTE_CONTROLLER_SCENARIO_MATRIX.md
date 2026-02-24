# Execute Controller Scenario Plan and Coverage Matrix

## Context

Request: execute the controller/worktree plan end-to-end in `$balls` mode.

Goal: make execute reliable by moving long-horizon orchestration into app-owned controller logic while keeping App Server as bounded-turn harness and preserving the locked public contract (`generate`, `execute`).

## Stakeholders

1. Primary operator (ScenarioForge user running generation/execute loops).
2. Maintainer team (needs deterministic, debuggable behavior).
3. Review/audit consumer (needs traceable scenario -> evidence -> PR lineage).

## Success Criteria

1. Execute no longer depends on one giant monolithic Codex turn.
2. Scenario progression is durable, resumable, and visible per scenario.
3. Repo execution happens in isolated worktrees per scenario attempt.
4. Bridge correctly handles JSON-RPC responses, notifications, and server-initiated requests.
5. Failures are explicit and actionable; no synthetic success/fabricated outcomes.

## Assumptions

1. Existing job lifecycle endpoints remain the integration surface.
2. Backward compatibility is required for existing persisted job records.
3. Local execution environment has git available.

## Known Risks and Failure Modes

1. JSON-RPC server requests are dropped (approval/input request deadlock).
2. Concurrent writes collide without worktree isolation.
3. Timeouts produce partial payload interpretation and false terminal states.
4. Retry loops can re-run wrong scenarios if scenario subset constraints drift.
5. PR creation can fail due to token/repo permissions; must report limitation explicitly.

## Scenario Coverage Matrix

| Scenario ID | Scenario | Acceptance checks | Unit tests | Regression tests |
| --- | --- | --- | --- | --- |
| EC-01 | Bridge handles JSON-RPC server responses, notifications, and server requests correctly | Request/response routing distinguishes `id+result` vs `id+method`; approval requests receive responses; no deadlocked turns | Add `tests/unit/bridgeJsonRpcRouting.test.ts` for message classification + request dispatch | Extend `tests/regression/fullFlow.test.ts` with mocked server-request approval path |
| EC-02 | Execute uses per-project repo sync and per-scenario worktree isolation | Worktree path is unique per scenario attempt; branch/worktree cleanup metadata persists; no shared writable cwd between scenarios | Add `tests/unit/worktreeManager.test.ts` for sync/create/remove and branch naming determinism | Add regression flow that runs two scenario attempts and asserts unique worktree branches |
| EC-03 | Controller loops scenario-by-scenario with bounded attempts | Each scenario transitions through queued/running/fixing/rerun/terminal; one failure does not stop later scenarios | Add `tests/unit/executeControllerStateMachine.test.ts` for transitions and attempt limits | Extend `tests/regression/fullFlow.test.ts` to verify full pack continues after first scenario failure |
| EC-04 | Timeout and transport failure handling is fail-closed | Timeout marks scenario failed with explicit limitation; no partial-output success parsing | Add `tests/unit/executeTimeoutHandling.test.ts` for timeout paths and status guarantees | Add regression case with simulated delayed turn completion and verify explicit failure evidence |
| EC-05 | Scenario subset selection and retry-failed remain stable | Selected scenario IDs are honored end-to-end; retry-failed only targets previous failures | Extend `tests/unit/runEngine.test.ts` for selected subset and failed-only filtering | Extend `tests/regression/fullFlow.test.ts` with failed-only retry subset scenario |
| EC-06 | Deterministic PR path and explicit PR limitations | PR is created only on verified rerun evidence; missing perms create explicit failed outcome with remediation | Extend `tests/unit/fixPipeline.test.ts` and/or add `tests/unit/prCreationPath.test.ts` | Regression case for permission-denied PR creation with actionable surfaced reason |
| EC-07 | UI scenario state affordance reflects controller truth | Scenario rows update stage-by-stage and persist when navigating away/back; active jobs reopen correctly | Add focused unit tests for event->row state mapping where feasible | Extend `tests/regression/fullFlow.test.ts` for resume-active-job visibility and no reset-to-start behavior |
| EC-08 | Auditability and artifact linkage remain intact | Run/fix/pr records link to scenario IDs with timestamps and evidence artifacts | Extend `tests/unit/reviewBoard.test.ts` and run/evidence tests for linkage integrity | Regression flow verifies export/report contains scenario checks + PR references/limitations |

## Validation Gates (Required Before Commit)

1. `pnpm check`
2. `pnpm test:unit`
3. `pnpm test:regression`

If a suite fails for unrelated reasons, document exact failure and scope impact before commit.
