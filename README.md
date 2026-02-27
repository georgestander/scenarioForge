# ScenarioForge

![ScenarioForge Cover](public/scenarioForge.png)

ScenarioForge is an experiment in building a scenario-first quality loop on top of new Codex tooling.

Instead of writing brittle test scripts first, you:
- declare intent in a UI,
- let Codex generate scenario contracts from real code + selected docs,
- run execute loops that capture observed vs expected evidence,
- optionally produce PR outcomes when automation is actually ready.

## Why this project is interesting

This repo is intentionally built to test a very specific product shape:
- RedwoodSDK app as the intent and visibility layer.
- Thin Worker bridge with minimal orchestration.
- Codex app-server as the reasoning/execution engine.
- Explicit readiness gates for any “full PR automation” claims.

It is not pretending to be a generic test framework. It is a focused integration exercise for modern Codex-driven workflows.

## Product contract (locked)

ScenarioForge exposes only two core actions:
- `generate`
- `execute`

Everything else supports those actions:
- auth,
- source trust gate,
- stream/event rendering,
- audit persistence,
- dashboards/history.

Complex “what should happen next?” logic is pushed into Codex turns and controller policies, not spread across UI click handlers.

## End-to-end user flow

1. Sign in with ChatGPT.
2. Connect GitHub repository/branch.
3. Run source scan and confirm trusted context (code baseline required, docs optional).
4. Generate scenarios.
5. Review scenario pack.
6. Execute (`run`, `fix`, `pr`, or `full`).
7. Inspect completed evidence, PR outcomes, and dashboard history.

## Execution modes and promises

- `run`: evidence bundle only (no fix and no PR attempt).
- `fix`: patch + evidence bundle (no PR attempt).
- `pr`: PR proposal metadata only.
- `full`: patch + evidence + controller-attempted PR.

`full` mode is gated by readiness and fails fast when blocked.

## PR readiness model

Readiness is actuator-based, not generic “GitHub connected”.

Current readiness includes:
- `fullPrActuator`: `controller` | `codex_git_workspace` | `codex_connector` | `none`
- machine-readable `reasonCodes[]`
- human-readable `reasons[]`
- `recommendedActions[]`
- deterministic `probeResults[]`
- `checkedAt` and `probeDurationMs`

UI and server both enforce readiness for `executionMode=full`.

## Telemetry

The app records reason-code-aware telemetry events:
- `readiness_checked`
- `full_mode_blocked`
- `execute_mode_selected`
- `full_mode_started`
- `full_mode_completed`
- `manual_handoff_emitted`

Dashboard surfaces top blocker codes so you can see why full automation is failing in practice.

## Architecture at a glance

- UI (`src/app`): intent capture, mode controls, stream/status boards.
- Worker (`src/worker.tsx`): auth checks, validation, thin action dispatch, persistence hooks.
- Services (`src/services`):
  - `codexScenario.ts` and `codexExecute.ts` for Codex bridge calls,
  - `sourceGate.ts`, `scenarioGeneration.ts`, `prReadiness.ts` for domain logic,
  - `durableCore.ts` + `store.ts` for persistence/hydration.
- Docs (`docs`): implementation authority and backlog.

## Local development

### Prerequisites

- Node.js
- pnpm
- `codex` CLI available in `PATH` (bridge launches `codex app-server`)
- GitHub App credentials

### Environment setup

Create or update `.dev.vars` with:
- `AUTH_SECRET_KEY`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_INSTALL_URL`
- `CODEX_AUTH_BRIDGE_URL`

Notes:
- Default local bridge endpoint is `http://127.0.0.1:4319`.
- Never commit real secrets.

### Install

```bash
pnpm install
```

### Run (recommended)

```bash
pnpm dev
```

`pnpm dev` starts:
- the local auth/Codex bridge (`scripts/codex-auth-bridge.mjs`)
- the Redwood/Vite app (`pnpm dev:app`)

### Run parts separately (optional)

```bash
pnpm dev:auth-bridge
pnpm dev:app
```

## Useful commands

```bash
pnpm types
pnpm test:unit
pnpm test:regression
pnpm build
```

## API surfaces you will touch most

- `POST /api/projects/:projectId/actions/generate/stream`
- `POST /api/projects/:projectId/actions/execute/start`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/events`
- `POST /api/jobs/:jobId/control` (`pause` | `resume` | `stop`)
- `GET /api/jobs/active`
- `GET|POST /api/projects/:projectId/pr-readiness`

## Troubleshooting

- `executionMode=full is blocked...`
  - Run readiness check and use returned `reasonCodes` + `recommendedActions`.
  - Use `fix` mode while blockers are unresolved.

- `Invalid schema for response_format ... required ...`
  - The execute output schema is strict. Ensure required keys are present in Codex output contract.

- D1 insert mismatch errors (`N values for M columns`)
  - Verify SQL placeholder count matches declared columns in `src/services/durableCore.ts`.

- Bridge/auth failures
  - Confirm `CODEX_AUTH_BRIDGE_URL` is reachable.
  - Confirm ChatGPT sign-in is active.
  - For non-interactive runs, the bridge now auto-answers `tool/requestUserInput` prompts with a safe default (`decline`). Override with `CODEX_AUTH_BRIDGE_USER_INPUT_POLICY=accept|cancel|first|error`.

- Need to pause or stop a long execute loop
  - Use the Execute page controls (`Pause`, `Resume`, `Stop`) which call `/api/jobs/:jobId/control`.
  - Stop requests attempt to interrupt the active Codex turn and persist partial audit evidence.

## Project status and authority

Implementation authority order:
1. `docs/IMPLEMENTATION_PLAN.md`
2. `docs/ARCHITECTURE.md`
3. `docs/EXECUTION_BACKLOG.md`

Session-level decisions and progress are tracked in `docs/IMPLEMENTATION_PLAN.md`.
