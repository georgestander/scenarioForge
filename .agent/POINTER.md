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

## Session Audit Trail

- 2026-02-23: Home page hero image was constrained to prevent it from dominating the viewport and pushing core UI/forms below the fold.
- Decision: Keep hero art as supporting context only, with bounded card/image height so the primary workflow remains visible on first view.
- Next action: Continue Phase 2 source trust gate work (`SF-2001` to `SF-2003`) on top of the current UI shell.
- 2026-02-23: Replaced the Phase 1 shell panel with a strict 3-step setup wizard (`Sign in -> Connect GitHub -> Create project`) and removed manual GitHub installation ID input from UX.
- Decision: GitHub connect now follows callback-based auto-connect; debug/session payloads moved behind a collapsed `Advanced` section to keep the primary flow clean.
- Next action: Implement real ChatGPT OAuth sign-in (replace current local sign-in stub), then proceed to Phase 2 source trust gate work.
- 2026-02-23: Added model normalization in session storage/listing so all thread start payloads are forced to `gpt-5.3-xhigh`, including legacy in-memory sessions created with `gpt-5.1-codex`.
- Decision: Prevent stale local state from surfacing old model names in Advanced debug output.
- Next action: Keep this enforcement until full persistent storage migration and auth hardening are complete.
