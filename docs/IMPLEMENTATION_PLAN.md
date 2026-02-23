# ScenarioForge Implementation Plan

## 1. Vision

ScenarioForge is an intent-driven scenario quality system:
- user clicks intent in UI,
- Codex app-server performs generation or execution work in repo context,
- bridge streams progress and persists auditable artifacts.

Primary outcome:
- turn source-aware scenario validation into a repeatable run -> fix -> PR loop.

## 2. Locked Architecture Decisions

1. Keep the bridge thin.
2. Keep only two core server actions:
- `generate`
- `execute`
3. UI is intent capture and stream rendering, not orchestration.
4. Codex app-server is the execution engine.
5. Return raw errors from Codex/tooling without rewriting root cause.

## 3. Responsibility Boundaries

### 3.1 UI (RedwoodSDK)

UI owns:
- auth and repo connect flows,
- source selection and explicit trust confirmation,
- intent capture (`generate` initial/update, `execute`),
- streaming display and review surfaces.

UI does not own:
- scenario synthesis logic,
- execution/fix/PR orchestration logic.

### 3.2 Bridge (Worker API)

Bridge owns:
- request validation,
- auth and project ownership checks,
- calling Codex app-server turns,
- streaming event passthrough,
- persistence of manifests/packs/runs/evidence references.

Bridge does not own:
- multi-step custom decision trees,
- custom scenario or fix planner logic.

### 3.3 Codex App-Server

Codex owns:
- source synthesis and scenario generation,
- scenario execution loop,
- failure analysis and fix implementation,
- rerun gating,
- PR preparation and authoring output.

## 4. Action Contracts

## 4.1 `generate`

Purpose:
- create initial scenarios or update existing scenario packs based on user intent.

Request:
- `projectId` (string)
- `repo` (string)
- `branch` (string)
- `sourceManifestId` (string)
- `mode` (`initial` | `update`)
- `userInstruction` (string, optional)

Behavior:
1. Verify manifest exists and belongs to project owner.
2. Start Codex turn using selected sources only.
3. Apply `$scenario` quality bar.
4. Persist scenario JSON + `scenarios.md` + audit metadata.

Output:
- `scenarioPackId`
- `revision`
- artifact references
- stream events

## 4.2 `execute`

Purpose:
- run scenario loop in repo context and produce evidence-backed PR outcomes.

Request:
- `projectId` (string)
- `repo` (string)
- `branch` (string)
- `scenarioPackId` (string)
- `executionMode` (`run` | `fix` | `pr` | `full`)
- `constraints` (object, optional)

Behavior:
1. Start Codex turn with repo-capable tools.
2. Execute selected scenarios.
3. For failures, implement targeted fixes.
4. Rerun impacted scenarios.
5. Prepare PR artifacts and evidence payloads.

Output:
- `runId`
- status summary
- evidence references
- PR records (if produced)
- stream events

## 5. Streaming Contract

Use server-sent events (or equivalent stream) from bridge to UI.

Event envelope:
- `eventId`
- `action` (`generate` | `execute`)
- `phase` (for UI display)
- `status` (`queued` | `running` | `passed` | `failed` | `blocked` | `complete`)
- `message`
- `payload` (typed object)
- `timestamp`

No fake progress. Emit only real step transitions.

## 6. Error Contract

Raw passthrough principle:
- preserve Codex/tooling error message and type,
- include optional bridge context (`projectId`, `action`, `turnId`) without mutating root cause,
- persist error with timestamp and request correlation ID.

## 7. Source Trust Gate (Mandatory)

Before `generate`:
1. scan repo planning/spec/task docs,
2. score `trusted/suspect/stale/excluded`,
3. let user select/deselect,
4. require explicit confirmation when stale/conflicting docs are selected,
5. persist manifest hash and selected source IDs.

Only selected sources are provided to Codex generation turns.

## 8. Scenario Quality Standard

Every generated scenario must include:
- scenario ID,
- persona and objective,
- preconditions/test data,
- realistic end-to-end steps,
- expected checkpoints,
- edge variants,
- binary pass criteria.

Group scenarios by:
- feature area,
- user outcome.

## 9. Auth and Persistence

### 9.1 ChatGPT Sign-In

- Session-backed user identity for project ownership and audit records.

### 9.2 GitHub Connection

- One-time connect per user/account intent.
- Reconnect only when token is expired, revoked, or installation changed.
- Persist installation context and refresh token state.

### 9.3 Auditability

Persist and link:
- manifest hash,
- scenario pack revision,
- run and fix attempts,
- evidence artifact references,
- PR linkage to scenario IDs.

## 10. Delivery Phases

### Phase 1 (Done)
- ChatGPT sign-in, GitHub connect, project ownership.

### Phase 2 (In Progress)
- Source scan, relevance scoring, confirmation gate, manifest persistence.

### Phase 3
- `generate` action contract + streaming + scenario artifact persistence.
- Support both `initial` and `update` modes.

### Phase 4
- `execute` action contract + streaming.
- Run/fix/rerun/PR flow with evidence capture.

### Phase 5
- UX hardening: affordances, retries, error visibility.
- GitHub persistence and reconnect experience hardening.

### Phase 6
- Review board and export artifacts from real persisted evidence.

## 11. Definition of Done (Current Alignment)

1. `generate` works end-to-end with source gate and stream updates.
2. `generate(mode=update)` revises scenario packs from user intent.
3. `execute` works end-to-end with real loop and PR evidence.
4. GitHub reconnect is not repeatedly required during normal use.
5. Errors are visible, raw, and traceable.
