# ScenarioForge Pointer

## Session Date

2026-02-23

## Alignment Decisions Locked

1. Keep bridge thin: pass-through + streaming + raw errors.
2. Keep exactly two core server actions:
- `generate`
- `execute`
3. Treat UI buttons as user intent mapping to Codex turns.
4. Support scenario updates through `generate(mode=update)` with optional user instruction.
5. Codex app-server is the execution engine for scenario generation and run/fix/PR loops.
6. GitHub connect should be one-time in normal operation; reconnect only for real token/install issues.

## Current Status Snapshot

- Docs are aligned to the locked 2-action architecture.
- Legacy Codex session scaffold was removed from worker/UI.
- Bridge now supports action endpoints:
  - `POST /actions/generate`
  - `POST /actions/execute`
  - optional stream variants (`/stream`) with SSE events.
- Bridge now extracts structured turn outputs when no `agentMessage` text is emitted.
- Worker now exposes thin action routes:
  - `POST /api/projects/:projectId/actions/generate`
  - `POST /api/projects/:projectId/actions/execute`
- UI Stage 3+4 now uses intent actions:
  - Generate
  - Update Scenarios
  - Execute Loop
- Auth persistence hardened:
  - principals are persisted on sign-in completion,
  - principal reuse path added when ChatGPT email is unavailable.

## Immediate Next Actions

1. Add worker stream passthrough for action routes so UI can consume live Codex events directly.
2. Harden execute-output parsing against broader Codex output variants and include explicit mismatch diagnostics.
3. Replace placeholder PR record URLs with real GitHub PR creation flow in execute mode when tool/auth context allows.
4. Remove/retire legacy non-action endpoints once no longer needed by UI.
5. Add integration tests covering `actions/generate` and `actions/execute` request/response contracts.

## Risks to Watch

- Tool/auth availability drift can still block full execute loop behavior.
- Execute JSON shape can vary by model behavior and needs strict validation + fallback messaging.
- Streaming is implemented in the bridge, but worker/UI passthrough is not yet end-to-end.
