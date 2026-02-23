# ScenarioForge Pointer

Last updated: 2026-02-23

## Project Intent

Ship a full-flow scenario-first quality product for the Codex challenge.

## Current Source of Truth

1. `README.md`
2. `docs/IMPLEMENTATION_PLAN.md`
3. `docs/ARCHITECTURE.md`
4. `docs/EXECUTION_BACKLOG.md`
5. `AGENTS.md`

## Locked Core Decisions

- Frontend stack: RedwoodSDK.
- Orchestration: Codex app-server.
- Auth: ChatGPT sign-in + GitHub integration.
- Source gate: users can select/deselect PRDs/specs/plans and must confirm relevance.
- Scenario research model: `codex spark`.
- Implementation/fix model: `gpt-5.3-xhigh`.

## Phase Status

- Phase 0 foundation: implemented.
- Available now:
  - Project create/list API
  - Codex session skeleton API
  - Phase 0 UI shell for project/session bootstrap
  - Architecture and execution docs

## Immediate Next Step

Implement Phase 1:
1. ChatGPT auth integration.
2. GitHub App auth and repo connection.
3. Ownership checks for project/session operations.
