# Stream Execution UI Contract (Phases 3–4)

Status: Active draft
Last updated: 2026-02-24

This contract is to lock behavior while UI overhaul continues. It is intentionally strict and intentionally minimal.

## 1) Streaming Contract for Checklist UX

### 1.1 Event Envelope (required)
Each stream event consumed by ScenarioForge UI must expose:

- `type` (string): event category (`queue` | `action` | `progress` | `artifact` | `result` | `error`)
- `runMode` (string): `generate` | `execute`
- `phase` (string):
  - `generate` for SF-300x
  - `run`, `fix`, `rerun`, `pr`, `complete` for SF-400x
- `timestamp` (ISO-8601)
- `correlationId` (string): project-scoped id for a single action invocation
- `scenarioId` (string, optional): required for scenario-level rows
- `scenarioPackId` (string): required for execute scenario updates
- `runId` (string, optional): required for execute/repair flows
- `attempt` (integer, optional): 1 for initial, increments on reruns
- `status` (string): `queued` | `running` | `passed` | `failed` | `blocked`
- `message` (string): human-readable event text
- `details` (string | object, optional): machine-readable payload

### 1.2 UI Checklist Row Model
For each scenario shown in board/checklist, UI must render/update these fields from events:

- `scenarioId`
- `title` (or stable short label)
- `status` (`pending` | `running` | `passed` | `failed` | `blocked`)
- `stage` (`generate` | `run` | `fix` | `rerun` | `pr`)
- `attempt`
- `lastEvent`
- `lastUpdated`
- `artifactRefs` (array of `{ type, url, label }`)
- `errorSummary` (string, optional)

### 1.3 Required event-to-row behavior
- When generate starts: add rows as `pending` for all discovered scenarios.
- When execute starts: seed rows from the selected scenario pack in deterministic order.
- When a scenario receives execution updates: set `status` and `stage` from latest authoritative event.
- In serial execution mode, exactly one scenario row is visually active (`status=running`) at a time.
- If stream indicates error at scenario scope, set `status=failed` and display raw error text in `errorSummary`.
- If stream shape is missing required identifiers (`scenarioId` for scenario updates), do not invent synthetic rows; instead emit a top-level failure banner and preserve stream details.

### 1.4 Raw error rule
- Raw errors from upstream must not be rewritten by UI labels.
- Display message should include original `message` and `details` for debugability.

### 1.5 Loop completion requirement
- Execute action is not complete until every scenario row reaches a terminal status (`passed`, `failed`, or `blocked`).
- If the loop halts early, remaining scenarios must still transition to `blocked` with an explicit causal reason.
- UI must never infer blanket terminal states without upstream evidence; missing evidence is an action failure condition.

### 1.6 Full-mode PR fallback requirement
- For `executionMode=full`, every failed scenario must end with one of:
  - a real PR outcome with URL, or
  - a blocked manual handoff outcome with branch, root-cause summary, risk notes, and actionable implementation steps.
- Completed summary and exported report must display whichever outcome was produced.

## 2) Route Guard Matrix (server-authoritative)

### 2.1 Prerequisite states
- `Auth` = ChatGPT principal exists
- `Project` = project exists + belongs to principal
- `Connection` = GitHub app connected and active token context
- `RepoSelection` = project has `repo` + `branch` selected
- `Sources` = source scan and manifest persisted
- `PrReadiness` = latest PR automation readiness check persisted
- `ScenarioPack` = scenarios JSON + scenarios.md persisted
- `ReviewReady` = scenario pack has been reviewed/approved for execution
- `ExecuteResult` = execute invocation has run summary persisted

### 2.2 Redirect rules
- `/` : if `Auth` then `/dashboard` else marketing/sign-in.
- `/dashboard` : requires `Auth`, otherwise redirect `/`.
- `/projects/:projectId/connect` : requires `Auth` and project ownership.
  - missing project access -> `/dashboard`
- `/projects/:projectId/sources` : requires `Auth` + `Project` + `Connection` + `RepoSelection`.
  - missing `Connection` or `RepoSelection` -> `/projects/:projectId/connect`
  - missing project -> `/dashboard`
- `/projects/:projectId/generate` : requires `Auth` + `Project` + `Sources`.
  - missing `Sources` -> `/projects/:projectId/sources`
- `/projects/:projectId/review` : requires `Auth` + `Project` + `ScenarioPack`.
  - missing `ScenarioPack` -> `/projects/:projectId/generate`
- `/projects/:projectId/execute` : requires `Auth` + `Project` + `ScenarioPack` + `ReviewReady`.
  - missing -> `/projects/:projectId/review`
- `/projects/:projectId/completed` : requires `Auth` + `Project` + `ExecuteResult`.
  - missing -> `/projects/:projectId/execute`

### 2.3 Transition requirement
- Navigations must be server-driven when possible.
- If server cannot confirm state yet, page must render an explicit “state loading” state and not display stale route content.
- `executionMode=full` is action-gated, not route-gated: it requires latest `PrReadiness.isReady=true`, otherwise execute must fail fast with remediation guidance.

## 3) Rollout Validation Checklist

1. **Auth routing:** signed-in users should not be able to view `/` main flow pages until intended context is set; signed-out users should be re-directed to marketing/root.
2. **Source gate options:** manifest can be created with selected docs or explicit code-only mode (zero docs selected).
3. **Checklist render:** generated scenario count equals pack size and each row appears once.
4. **Live generation updates:** row status transitions at least through `pending -> running -> passed|failed|blocked` while generation stream runs.
5. **Live execution updates:** row transitions cover `run -> fix -> rerun -> pr` stages where present.
6. **Attempt tracking:** when rerun happens, attempt increments and row last-updated event is visible.
7. **Active-row affordance:** current scenario is visually highlighted while running and clears on terminal status.
8. **Artifact linkage:** artifacts attach as soon as stream emits `artifact` event with persisted URLs.
9. **Invalid stream shape:** missing scenario identifiers results in visible failure, not synthetic or guessed checklist rows.
10. **Raw error visibility:** errors retain original message/details in UI and are not reduced to generic placeholders.
11. **PR readiness gating:** full mode is disabled in UI and rejected server-side until readiness is green.
12. **Completed handoff:** completed route summarizes pass/fail/blocked counts from authoritative run data and supports markdown export with per-scenario checks plus PR URL or blocked manual handoff details.

## 4) Out-of-Scope for UI Overhaul

- No orchestration changes in bridge UI; backend and Codex should remain source-of-truth for sequencing.
- No synthetic “blocked” rows without event evidence.
- No client-only auth/project truth for guard decisions.
- Parallel scenario execution is not required by this contract; serial deterministic execution remains the default.
