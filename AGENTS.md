# AGENTS.md

## Mission

Build `ScenarioForge`: a RedwoodSDK + Codex app-server product where UI intent triggers Codex-driven scenario generation and execution loops inside the selected repository.

## Locked Product Contract

ScenarioForge uses a thin bridge with only two core server actions:
- `generate`
- `execute`

Bridge behavior is intentionally minimal:
- pass-through request handling,
- live event streaming to the UI,
- raw error passthrough,
- minimal persistence for auditability.

Complex orchestration logic belongs in Codex turns, not in bridge code.

## Startup Read Order

On each session, read in this order:
1. `README.md`
2. `docs/IMPLEMENTATION_PLAN.md`
3. `.agent/POINTER.md`

## Implementation Authority

If there is any conflict, authority order is:
1. `docs/IMPLEMENTATION_PLAN.md`
2. `docs/ARCHITECTURE.md`
3. `docs/EXECUTION_BACKLOG.md`

`.agent/POINTER.md` is an audit and handoff record, not source-of-truth spec.

## Non-Negotiables

1. Source trust gate is mandatory before scenario generation.
2. If selected docs are stale or conflicting with code, warn and require explicit confirmation.
3. UI is intent-only; generation/execution logic is Codex-driven.
4. Preserve auditability of every generation and execution run.
5. No secrets in repo.
6. Keep PRs traceable to scenario IDs and rerun evidence.

## Intent Model

Buttons represent user intent that maps to Codex actions.

- `Generate Scenarios`: call `generate` with `mode=initial`.
- `Update Scenarios`: call `generate` with `mode=update` and optional user instruction.
- `Execute`: call `execute` for run/fix/rerun/PR flow.

## Tooling Contract

Codex app-server must run with configured repo-capable tools and required auth context.

Treat tool access as runtime-configured:
- available only if configured,
- bounded by sandbox/policy,
- bounded by active auth.

## Model Routing

Use `codex spark` for:
- source synthesis,
- feature/outcome mapping,
- scenario research and generation.

Use `gpt-5.3-xhigh` for:
- implementation fixes,
- complex refactors,
- PR-quality technical reasoning.

## Workflow Guardrails

1. Do not generate scenarios from deselected sources.
2. Always include edge-case variants and binary pass criteria.
3. Do not open a PR without rerun evidence for impacted scenarios.
4. Keep UX linear: connect -> select -> generate -> execute -> review.

## Update Contract

At the end of each meaningful build session, update `.agent/POINTER.md` with:
- decisions made,
- current implementation status,
- next actions.
