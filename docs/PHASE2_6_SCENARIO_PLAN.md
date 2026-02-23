# Phase 2-6 Scenario Plan

Date: 2026-02-23
Scope: Deliver phases 2 through 6 in one end-to-end vertical slice.

## Request Context

Build the full ScenarioForge flow after Phase 1:
- Source relevance gate with explicit user confirmation.
- Scenario generation grouped by feature and user outcome.
- Scenario run orchestration with status and evidence.
- Auto-fix pipeline with PR artifacts and rerun proof.
- Review board with recommendations and exportable report.

## Stakeholders

- Product owner/judges: require full-flow demo with auditable evidence.
- Builder (signed-in user): needs linear, low-friction workflow.
- Reviewer: needs clear risk/readiness board and rerun proof.

## Success Criteria

- User can complete connect -> select sources -> generate -> run -> fix -> review in one UI flow.
- Source trust gate blocks generation until explicit relevance confirmation.
- Scenario packs include required contract fields and source manifest linkage.
- Runs persist deterministic scenario statuses plus evidence artifacts.
- Failed scenarios can trigger auto-fix records and PR records with rerun evidence.
- Review board consolidates run/fix/PR state and exports a challenge-ready report.

## Assumptions

- In-memory persistence is acceptable for this phase sweep.
- Execution, fix, and PR steps are deterministic simulations (contract-complete) rather than live external side effects.
- Existing Phase 1 auth + GitHub install flow remains unchanged.

## Known Risks and Failure Modes

- Risk: stale sources contaminate scenario quality.
  Mitigation: trust statuses + warning banner + mandatory relevance confirmation.
- Risk: deselected sources accidentally influence generation.
  Mitigation: generation endpoint accepts selected source IDs only and validates ownership/project linkage.
- Risk: non-deterministic run outcomes reduce auditability.
  Mitigation: deterministic outcome rules and persisted run/evidence records.
- Risk: auto-fix emits PR without rerun proof.
  Mitigation: fix flow records rerun summary in PR payload before "open" status.
- Risk: review board drifts from actual run records.
  Mitigation: board computed from persisted run/fix/PR entities, not client-only state.

## Sub-Agent Mandates

### Scout (codepath and surface minimization)

- Scope: identify smallest set of files/endpoints/models to extend from Phase 1.
- Constraints: preserve Phase 1 auth/repo UX; no secret handling regressions.
- Output:
  - Extend `src/domain/models.ts` contracts.
  - Extend `src/services/store.ts` for new entities.
  - Add phase services for source/scenario/run/fix/review logic.
  - Add API routes in `src/worker.tsx`.
  - Replace Phase 1 page body with linear phase 2-6 workflow UI in `src/app/pages/welcome.tsx`.

### Verifier (edge cases and validation strategy)

- Scope: enforce binary acceptance and regression guards.
- Constraints: tests must map to scenario risks.
- Output:
  - Unit suites for source gate, scenario generation, run/fix/review orchestration.
  - Regression suite for end-to-end domain/service flow invariants.
  - Typecheck + unit + regression command chain documented and executed.

## Reconciliation Notes

- Scout suggested separate pages per phase; Verifier preferred one linear surface to reduce state-sync risk.
- Decision: implement one linear "mission control" workflow in a single page with clear phase sections and locked progression.

## Scenario Coverage Matrix

| Scenario ID | Scenario | Acceptance checks | Unit suite mapping | Regression suite mapping |
| --- | --- | --- | --- | --- |
| S1 | User scans sources and sees typed inventory with trust status | Scanner returns typed sources and computed statuses for project | `tests/unit/sourceGate.test.ts` (`scanSourcesForProject`, `scoreSource`) | `tests/regression/fullFlow.test.ts` source scan phase |
| S2 | User deselects stale source and confirms relevance | Generation blocked until confirmation, deselected sources excluded | `tests/unit/sourceGate.test.ts` (`validateGenerationSelection`) | `tests/regression/fullFlow.test.ts` source confirmation gate |
| S3 | User generates feature/outcome grouped scenarios | Scenario pack includes grouped collections and contract-complete scenarios | `tests/unit/scenarioGeneration.test.ts` (`generateScenarioPack`) | `tests/regression/fullFlow.test.ts` generation phase |
| S4 | Scenario records persist with source manifest linkage | Stored pack references manifest hash + selected source IDs | `tests/unit/scenarioGeneration.test.ts` (`buildSourceManifest`) | `tests/regression/fullFlow.test.ts` generation persistence |
| S5 | User runs scenarios and sees deterministic queued/running/final statuses | Run includes per-scenario status timeline and stable run ID | `tests/unit/runEngine.test.ts` (`createScenarioRun`, status transitions) | `tests/regression/fullFlow.test.ts` run orchestration |
| S6 | Failure entries include evidence artifacts and root-cause hypothesis | Failed scenario stores logs/traces/screenshot refs + hypothesis | `tests/unit/runEngine.test.ts` (`captureFailureEvidence`) | `tests/regression/fullFlow.test.ts` failure evidence |
| S7 | User triggers auto-fix for failed scenarios | Fix attempt links failed scenario IDs and produces patch summary | `tests/unit/fixPipeline.test.ts` (`createFixAttempt`) | `tests/regression/fullFlow.test.ts` fix phase |
| S8 | PR record requires rerun proof before open status | PR payload includes rerun summary + scenario linkage | `tests/unit/fixPipeline.test.ts` (`createPullRequestRecord`) | `tests/regression/fullFlow.test.ts` PR gate |
| S9 | Review board aggregates run/fix/PR risks and recommendations | Board returns readiness, risk map, prioritized recommendations | `tests/unit/reviewBoard.test.ts` (`buildReviewBoard`) | `tests/regression/fullFlow.test.ts` review aggregation |
| S10 | Export report is challenge-ready and traceable | Export includes project, manifest, run stats, fix/PR evidence | `tests/unit/reviewBoard.test.ts` (`buildChallengeReport`) | `tests/regression/fullFlow.test.ts` report export |

## Validation Command Contract

- Typecheck: `npm run types`
- Unit tests: `npm run test:unit`
- Regression tests: `npm run test:regression`

No implementation starts until this plan and matrix exist.
