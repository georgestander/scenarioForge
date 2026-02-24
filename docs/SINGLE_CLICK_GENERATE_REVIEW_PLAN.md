# SINGLE_CLICK_GENERATE_REVIEW_PLAN

## 1. Objective

Re-align Scenario Forge to the locked product contract:

- Thin bridge.
- Two core actions only: `generate`, `execute`.
- UI is intent and visibility, not orchestration.
- Codex app-server + `$scenario` skill do the real work.

This plan removes fake/synthetic behavior, collapses generation into a single user action, and introduces reliable retry/resume so users do not restart from zero after every error.

Execution controller and git-worktree implementation details are captured in:

- `docs/APP_SERVER_CONTROLLER_WORKTREE_PLAN.md`

---

## 2. Deep-Dive Findings (Current State)

### 2.1 Real Issues Confirmed

1. Generate path still uses multi-click progression:
   - Sources creates manifest.
   - Then user navigates to Generate.
   - Then user starts generation.

2. Execute path contains synthetic/fallback behavior that can look like real work:
   - Manual PR handoff synthesis is created when details are missing.
   - Legacy synthetic endpoints still exist for scenario-runs/fix-attempts/pull-requests.

3. Execute bridge contract is over-constrained and mixed-mode:
   - Complex schema and fallback behavior increase drift and failure surface.
   - Execution may persist deterministic failed runs on exceptions rather than strictly reflecting Codex output.

4. UX confusion sources:
   - Raw stream noise shown where user needs scenario-level progress.
   - Too many action buttons in generate/review.
   - Inconsistent step affordances (what is done/current/running).

5. Retry/resume exists partially (background job model), but retry intent is not first-class:
   - Users can reopen active jobs.
   - There is no explicit “retry failed scenarios from last run” primary flow.

### 2.2 Already Good Foundations To Keep

1. Background execution job model exists and is useful:
   - `POST /api/projects/:projectId/actions/execute/start`
   - `GET /api/jobs/:jobId`
   - `GET /api/jobs/:jobId/events`
   - `GET /api/jobs/active`

2. Active pack/manifest state is persisted per project.

3. Code baseline + source trust gate is implemented (code required, docs optional).

---

## 3. North-Star Product Behavior

### 3.1 Single-Click Generate -> Review

From **Sources**, one click should:

1. Validate trust confirmation.
2. Persist manifest.
3. Start `generate` stream immediately.
4. Show scenario count progress (not low-level protocol lines).
5. Route directly to Review list on completion.

No intermediate dead-end screen.

### 3.2 Trustworthy Execute Loop

Execute must represent only real outcomes from Codex skill execution.

- Per scenario status only: `queued`, `running`, `passed`, `failed`.
- If environment/tooling blocks progress, scenario should be `failed` with explicit observed limitation.
- No fabricated “manual handoff” PR records as if they were generated outcomes.
- No synthetic fallback scenario rows.

### 3.3 Retry Without Full Restart

From Execute and Completed views, user can:

1. Retry failed scenarios only (same pack).
2. Retry full pack.
3. Resume active job.
4. Run update+execute again without regenerating from scratch unless they explicitly choose to regenerate.

---

## 4. Guardrails (Non-Negotiable)

1. Keep only core action intents: `generate`, `execute`.
2. Keep app-server turns bounded and avoid giant single-turn execute orchestration.
3. Execute scheduling/retry progression must be app-controller owned and durable.
4. Never fabricate scenario, fix, PR, or artifact outcomes.
5. Raw errors pass through with context; no masking.
6. Keep full audit trail: manifest -> pack -> run -> fix -> PR.

---

## 5. Implementation Plan (Detailed)

## 5.1 Workstream A: Remove Synthetic/Fake Paths

### A1. Disable legacy synthetic POST endpoints

Scope:

- `/api/projects/:projectId/scenario-runs` POST
- `/api/projects/:projectId/fix-attempts` POST
- `/api/projects/:projectId/pull-requests` POST

Action:

- Keep GET for historical reads.
- Return `410 Gone` (or `405`) for legacy POST with clear message:
  - “Deprecated synthetic endpoint. Use /actions/execute.”

Files:

- `src/worker.tsx`
- `src/services/runEngine.ts` (remove unused export usage)
- `src/services/fixPipeline.ts` (remove synthetic PR creator usage path)

### A2. Remove synthetic fallback PR handoff fabrication

Action:

- Delete worker synthesis branch that manufactures PR fallback rows when missing.
- If Codex execute output is incomplete, fail the job/run with explicit error.

Files:

- `src/worker.tsx` (buildPullRequestInputsFromCodexOutput and fixAttempt fallback behavior)

### A3. Remove synthetic failed-run generation on execute exception

Action:

- Stop creating deterministic failed scenario-run records from exceptions.
- Persist job as failed with structured error details.
- Keep scenario rows in UI from latest known event state + explicit terminal error banner.

Files:

- `src/worker.tsx`

Acceptance criteria:

- No code path writes fake run/fix/pr data after bridge/Codex failure.

---

## 5.2 Workstream B: Force Skill-Centric Generate/Execute

### B1. Enforce explicit skill usage for execute

Action:

- Set execute request `skillName` to `"scenario"` (or canonical execute skill wrapper if defined).
- Record requested/used skill in execution audit.

Files:

- `src/services/codexExecute.ts`
- `src/domain/models.ts` (execution audit model if needed)
- `src/services/durableCore.ts` (schema persistence if audit shape expanded)

### B2. Simplify execute output schema to required truth contract

Required output contract for execute persistence:

- `run.items[]` for every scenario in subset.
- terminal status per item (`passed` | `failed`).
- `observed`, `expected`, `artifacts` required.
- `fixAttempt` optional only when mode includes fix/pr/full and failures occurred.
- `pullRequests` optional list; only real URLs are treated as created PRs.

Action:

- Remove acceptance of placeholder terms (`pending`, `not in subset`, etc.) by hard rejecting output.
- If output invalid -> fail run with explicit “invalid execute payload” error.

Files:

- `src/services/codexExecute.ts`
- `src/worker.tsx`

Acceptance criteria:

- Execute cannot complete with partial placeholder chains.
- Invalid output never appears as successful scenario results.

---

## 5.3 Workstream C: Single-Click Sources -> Generate -> Review

### C1. Replace split flow with one intent button

Current:

- `create scenarios` + `Continue to generation` + `Generate Scenarios`.

Target:

- One primary button in Sources: `Generate Scenarios`.

Action path:

1. Ensure baseline exists.
2. Create manifest.
3. Start generate stream (`/actions/generate/stream`).
4. On completion navigate to `/projects/:id/review?packId=<newPackId>`.

Files:

- `src/app/pages/SourcesClient.tsx`
- `src/worker.tsx` (no endpoint changes required; use existing stream route)

### C2. Progress UX: scenario creation count, no raw noise by default

Action:

- Convert generate UI event display to user-facing progress:
  - `Created X/Y scenarios`
  - latest generated scenario ID/title
- Keep raw stream behind `?trace=1` only.

Files:

- `src/app/pages/GenerateClient.tsx`
- `src/app/shared/useStreamAction.ts`
- `src/app/shared/types.ts`

### C3. Review direct landing, no meaningless interstitial

---

## 6. Session Progress (2026-02-24)

Completed in this session:
1. Bridge JSON-RPC request/response dispatch corrected; approval requests are now handled instead of dropped.
2. Turn timeout behavior changed to fail-closed so partial turn output cannot be persisted as success.
3. Execute background job now runs selected scenarios sequentially with bounded per-scenario Codex turns and aggregates real terminal outcomes.
4. User-facing status normalization now treats prior `blocked` flows as explicit failed limitations (`passed|failed` visibility).

Still open:
1. Worktree isolation and per-scenario branch management from controller plan.
2. Deterministic controller-owned commit/push/PR operations and stronger PR-readiness remediation UX.

Action:

- Review page reads `packId` query param and selects that pack.
- Show list immediately with IDs (`SF-001`, etc.).
- Top actions only: `Download Markdown`, `Update Scenarios`, `Run Execute Loop`.

Files:

- `src/app/pages/review.tsx`
- `src/app/pages/ReviewClient.tsx`

Acceptance criteria:

- One click from Sources initiates generation and ends at ready-to-run Review.

---

## 5.4 Workstream D: Retry/Resume Without Restart

### D1. Add explicit retry modes to execute start endpoint

Keep endpoint:

- `POST /api/projects/:projectId/actions/execute/start`

Add optional payload:

- `retryFromRunId?: string`
- `retryStrategy?: "failed_only" | "full"`
- `scenarioIds?: string[]` (derived server-side for failed_only if omitted)

Behavior:

- `failed_only`: run subset of last failed scenarios from selected run.
- `full`: run all scenarios in selected pack.

Files:

- `src/worker.tsx`
- `src/services/store.ts` (if job metadata extensions needed)
- `src/domain/models.ts` (job metadata extension)
- `src/services/durableCore.ts` (persist new job fields)

### D2. UI actions for retry and resume

Execute page:

- If active job exists: `Resume Active Run`.
- If latest run has failures: `Retry Failed`.
- Always: `Run Full`.

Completed page:

- `Retry Failed Scenarios` button near top actions.
- `Run Full Loop Again` button.

Files:

- `src/app/pages/ExecuteClient.tsx`
- `src/app/pages/CompletedClient.tsx`

### D3. Preserve project progress when navigating steps

Action:

- Never clear `activeManifestId`, `activeScenarioPackId`, `activeScenarioRunId` on normal phase navigation.
- Only clear on explicit repo/branch change or explicit “Reset Project Flow”.

Files:

- `src/worker.tsx`
- `src/app/pages/*` routing/links

Acceptance criteria:

- User can leave and return without losing generated pack.
- Retry does not require re-scan or re-generate unless user chooses.

---

## 5.5 Workstream E: Execute UX Affordance (Agentic but Human-Clear)

### E1. Scenario-first status board

Show per scenario row:

- status icon
- scenario ID + title
- current stage (`run`, `fix`, `rerun`, `pr`)
- latest concise status message

No raw codex protocol by default.

### E2. Terminal summary clarity

Top summary block should include:

- passed / failed counts
- run ID
- started/completed timestamps
- PR created count (real URLs only)
- explicit error banner if run failed systemically

### E3. Completed page action placement

Move key actions to top area:

- Refresh board
- Export report
- Retry failed
- Run full again

Files:

- `src/app/pages/ExecuteClient.tsx`
- `src/app/pages/CompletedClient.tsx`

---

## 5.6 Workstream F: Report/Artifacts Contract

### F1. Ensure final report always reflects real evidence

Report sections:

- scenario outcomes
- observed vs expected
- artifacts
- PR links (only real)
- explicit “PR not created” reason if absent

### F2. Markdown export quality

`review-report` markdown should include:

- manifest/pack IDs
- run ID
- per-scenario status with evidence links
- per-scenario PR linkage if available
- unresolved risk section

Files:

- `src/services/reviewBoard.ts`
- `src/worker.tsx` (`/review-report` route)

Acceptance criteria:

- Exported markdown can be handed to reviewers without additional context.

---

## 6. API/Model Change Matrix

## 6.1 No new core action types

Kept:

- `generate`
- `execute`

## 6.2 Optional execution payload extensions

Add to execute start payload:

- `retryFromRunId`
- `retryStrategy`
- `scenarioIds`

All still under existing `execute` action contract.

## 6.3 Data model extensions (minimal)

ExecutionJob optional fields:

- `retryFromRunId?: string | null`
- `retryStrategy?: "failed_only" | "full" | null`
- `scenarioIds?: string[]`

Persist in D1 JSON columns or added nullable columns.

---

## 7. Test Plan

## 7.1 Unit Tests

1. Execute output validator rejects placeholder/pending chains.
2. Execute persists no synthetic PR records when Codex output is missing PR/fix data.
3. Retry strategy `failed_only` resolves exact failed scenario subset.
4. Report generator marks missing PR as explicit limitation, not fabricated link.

Files:

- `tests/unit/*` (new tests in `codexExecute`, `worker`, `reviewBoard` suites)

## 7.2 Integration/Regression

1. Sources single-click generation ends on review with selected pack.
2. Back/forward navigation preserves manifest/pack/run context.
3. Execute background job can be resumed via jobId after page reload.
4. Retry failed scenarios starts new job without re-generating.
5. Multiple projects can run concurrently without context bleed.

Files:

- `tests/regression/fullFlow.test.ts` (extend)

## 7.3 Manual QA Checklist

1. Sign in auto-completes after ChatGPT callback without redundant clicks.
2. Connect once, pick repo/branch, scan sources.
3. Single click generate from Sources.
4. Review list shows IDs and can download markdown.
5. Execute shows per-scenario progression and terminal states.
6. Failed run can be retried (failed_only) and resumed.
7. Completed report includes real evidence and real PR URLs only.

---

## 8. Rollout Sequence

1. Cut synthetic paths + strict failure semantics.
2. Ship single-click generate flow.
3. Ship retry/resume actions.
4. Polish execute/completed affordance and report quality.

Each stage should be mergeable and testable independently.

---

## 9. Definition of Done

1. One click from Sources creates manifest and starts generation.
2. Generate lands directly in Review with selected pack.
3. Execute never fabricates scenario/fix/PR outputs.
4. Retry failed scenarios works without restarting from step 1.
5. User can leave and resume active runs by job ID.
6. Completed export is evidence-grade markdown with real links and explicit limitations.
7. End-to-end local run (`pnpm dev`) works across sign-in, connect, generate, execute, retry, review.

---

## 10. Out of Scope (for this cut)

1. New core action types beyond `generate` and `execute`.
2. Heavy bridge-side planner logic.
3. Cloud production deploy architecture changes.

This plan is focused on trustworthiness, flow speed, and rerun resilience in the current architecture.
