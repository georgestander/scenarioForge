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

- Docs have been realigned to the locked 2-action architecture.
- Phase 1 is complete.
- Phase 2 remains in progress.
- Next implementation focus is Phase 3 and Phase 4 action contracts.

## Immediate Next Actions

1. Implement thin `generate` endpoint contract and stream passthrough.
2. Implement `generate(mode=update)` from UI intent.
3. Implement thin `execute` endpoint contract and stream passthrough.
4. Persist scenario revisions, run evidence, and PR linkage records.
5. Harden GitHub persistence/reconnect behavior.

## Risks to Watch

- Hidden orchestration logic reappearing in bridge code.
- Event-stream mismatches between Codex output and UI expectations.
- Tool availability/auth drift causing execution instability.
