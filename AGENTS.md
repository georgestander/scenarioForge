# AGENTS.md

## Mission

Build `ScenarioForge`: a RedwoodSDK + Codex app-server product that turns real user scenarios into an execution and auto-fix loop.

The app must support:
- ChatGPT sign-in.
- GitHub repo connection.
- Source selection and deselection (PRDs/specs/plans/code).
- Relevance/staleness warnings before scenario generation.
- Scenario generation grouped by feature or user outcome.
- Scenario execution with live progress and evidence.
- Auto-fix flow with PR creation.
- Detailed review board with recommendations.

## Startup Read Order

On each session, read in this order:
1. `README.md`
2. `docs/IMPLEMENTATION_PLAN.md`

- If there is any conflict, implementation authority is:
  1. `docs/IMPLEMENTATION_PLAN.md`
  2. `docs/ARCHITECTURE.md`
  3. `docs/EXECUTION_BACKLOG.md`

## Non-Negotiables

1. Source trust gate is mandatory.
2. If selected docs are stale or conflicting with code, warn before generation and require explicit user confirmation.
3. Preserve auditability of every run.
4. No secrets in repo.
5. Keep PRs traceable to scenario IDs and validation evidence.

## Model Routing

Use `codex spark` for:
- Scenario research
- Source synthesis
- Feature/outcome mapping
- Fast triage

Use `gpt-5.3-xhigh` for:
- Implementation and fixes
- Complex refactors
- PR-quality technical reasoning

## Sub-Agent Roles

1. Source Ingestion Agent
2. Feature/Outcome Mapper Agent
3. Scenario Research Agent
4. Scenario Spec Agent
5. Scenario Runner Agent
6. Fix Planner Agent
7. Fix Implementation Agent
8. PR Authoring Agent
9. Review and Recommendation Agent

## Workflow Guardrails

1. Do not generate scenarios from deselected sources.
2. Always include edge-case variants and binary pass criteria.
3. Do not open a PR without re-run evidence for impacted scenarios.
4. Keep UX clean and linear: connect -> select sources -> generate -> run -> fix -> review.

## Current Plan Source

Primary plan lives at:
- `docs/IMPLEMENTATION_PLAN.md`
- Supporting implementation authority:
  - `docs/ARCHITECTURE.md`
  - `docs/EXECUTION_BACKLOG.md`

