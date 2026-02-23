# ScenarioForge

![ScenarioForge Cover](public/scenarioForge.png)

Scenario-first quality workflow for fast-moving teams: click intent in UI, let Codex do the work in-repo, stream evidence back live.

## Product Direction (Locked)

ScenarioForge is a RedwoodSDK UI plus a thin Codex app-server bridge.

The bridge exposes only two core actions:
- `generate`: create or update scenario packs from selected trusted sources.
- `execute`: run scenarios, fix failures, rerun impacted checks, and open PRs with evidence.

Everything in the UI is intent capture. Buttons are structured user intent, not local orchestration.

## Why This Exists

Traditional test layers often drift from how users actually use the product. At the same time, planning docs drift from the codebase.

ScenarioForge solves this by:
- enforcing a source trust gate before generation,
- generating realistic scenario contracts from selected sources,
- executing a fix loop directly in repo context,
- attaching evidence and PR traceability to each scenario outcome.

## Core Flow

1. Sign in with ChatGPT.
2. Connect GitHub once (reconnect only on token expiry/revocation).
3. Select and confirm trusted planning sources.
4. Generate scenarios (`generate`, mode `initial` or `update`).
5. Execute loop (`execute`) for run -> fix -> rerun -> PR.
6. Review outcomes and recommendations.

## Architecture Summary

- UI: intent layer and live stream display.
- Bridge: pass-through request, stream relay, minimal persistence, raw errors.
- Codex app-server: actual reasoning, tool usage, scenario/fix/PR loop.

No complex server-side orchestration beyond routing, auth, and persistence.

## Current Plan Sources

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/EXECUTION_BACKLOG.md`
- `AGENTS.md`
- `.agent/POINTER.md`

## Local Development

### Prerequisites

- Node.js
- pnpm

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev
```

Optional (app only):

```bash
pnpm dev:app
```

## Security and Repo Hygiene

- No secrets committed.
- Keep token scopes least privilege.
- Keep all generated PRs traceable to scenario IDs and rerun evidence.
