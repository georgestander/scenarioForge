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
- Phase 1 auth + repo connect: implemented.
- Available now:
  - ChatGPT sign-in/sign-out + session status API
  - GitHub App installation connect + repo list API
  - Project/session ownership enforcement by signed-in principal
  - Project create/list API
  - Codex session skeleton API (owner-scoped)
  - Phase 1 UI shell for auth/repo/project/session bootstrap
  - Architecture and execution docs

## Immediate Next Step

Implement Phase 2:
1. Source inventory scanner (`SF-2001`).
2. Relevance scoring (`SF-2002`).
3. Source selection UX with explicit confirmation (`SF-2003`).
