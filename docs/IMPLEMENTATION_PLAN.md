# ScenarioForge Build Plan

## 1. Vision

Build a full-flow collaborative quality platform where a user signs in with ChatGPT, connects a GitHub repository, selects trusted context sources (PRDs/specs/plans/code), generates high-volume realistic scenarios, runs them, fixes failures via Codex sub-agents, and opens review-ready PRs with evidence.

Primary user outcome:
- Convert abstract testing into concrete, scenario-based acceptance outcomes that can be executed and improved continuously.

## 2. Problem and Differentiator

Problem:
- Conventional tests are often too abstract for fast-moving "vibe coding" teams.
- Product docs become stale while code evolves, causing false assumptions during validation.

Differentiator:
- Scenario-first validation pipeline.
- Source relevance control (select/deselect PRDs/specs/plans before generation).
- Closed-loop automation: generate -> run -> fix -> PR -> review.
- Human-in-the-loop approvals where risk is high.

## 3. Product Scope (Full-Flow MVP+)

In scope:
- ChatGPT sign-in.
- GitHub auth and repository connection.
- Source discovery and explicit source selection/deselection.
- Relevance warnings for stale or conflicting sources.
- Scenario generation grouped by features or outcomes.
- Scenario execution runner with live progress.
- Auto-fix workflow for failed scenarios.
- PR generation per fix unit.
- Detailed review board with findings and recommendations.

Out of scope (initial release):
- Marketplace billing.
- Multi-repo monorepo graph optimization beyond baseline support.
- Native mobile client.

## 4. User Experience Blueprint

### 4.1 Onboarding

1. User signs in with ChatGPT.
2. User connects GitHub account.
3. User selects repository and default branch.
4. User lands on project workspace dashboard.

### 4.2 Source Relevance Gate (Critical)

1. System auto-discovers source artifacts:
- PRDs.
- Specs.
- Tasks/plans.
- Architecture docs.
- Code map and route/module inventory (baseline context only; not user-selectable).
2. System displays each source with:
- Last modified timestamp.
- Path.
- Type.
- Relevance score.
- Staleness/conflict warnings.
3. User can select/deselect discovered planning/spec/task documents (`.md`, `.txt`, `.json`).
4. User must confirm: "Selected sources are relevant to current app direction."
5. System stores source manifest for reproducibility.

### 4.3 Scenario Generation

1. User clicks "Generate Scenarios".
2. Worker API validates the confirmed source manifest and invokes Codex app-server turns.
3. Codex app-server performs source synthesis and creates scenario packs grouped by:
- Feature areas.
- End-user outcomes.
4. Each scenario includes:
- ID.
- Persona.
- Preconditions and test data.
- Step sequence.
- Expected results checkpoints.
- Edge variants.
- Binary pass criteria.
5. System persists structured scenario JSON and `scenarios.md` linked to manifest hash + repo/branch/head SHA.
6. UI presents generated scenarios and offers artifact download; UI does not perform scenario synthesis.

### 4.4 Run and Feedback

1. User clicks "Run All" or runs selected groups.
2. UI streams per-scenario status:
- Queued.
- Running.
- Passed.
- Failed.
- Blocked.
3. Each failure shows:
- Observed vs expected mismatch.
- Logs, screenshots, traces as available.
- Suspected root-cause hypothesis.

### 4.5 Fix and PR Flow

1. User clicks "Auto-fix Failed" for one scenario or batch.
2. Codex fix agents implement targeted changes.
3. System opens PRs with:
- Scenario linkage.
- Root cause summary.
- Code changes.
- Re-run evidence.
- Risk notes.
4. UI recommends merge order and flags dependency conflicts.

### 4.6 Review Board

1. Consolidated board displays:
- Scenario coverage status.
- PR status and review findings.
- Regression risk map.
- Improvement recommendations.
2. Export final report for judges/team stakeholders.

## 5. System Architecture

## 5.1 Frontend (RedwoodSDK)

Responsibilities:
- Auth/session UX.
- Repo/source/scenario management UI.
- Live execution dashboard.
- PR/review board.
- Artifact viewing and download controls.

Does not own:
- Scenario synthesis logic.
- Agent execution logic.

Why RedwoodSDK:
- Server-first React model.
- Cloudflare-friendly deployment path.
- Good fit for request/response + streaming UX.

## 5.2 Codex App Server Orchestrator

Responsibilities:
- Thread/turn lifecycle.
- Agent event streaming.
- Approval handling.
- Review mode invocation.
- Skills and app integration.
- Scenario generation and source synthesis execution.

Protocol shape:
- JSON-RPC 2.0 style over stdio/ws.
- App server methods for initialize, thread, turn, review, account/auth, skills, and app listing.

## 5.3 Execution Layer

Components:
- Scenario runner workers.
- Repo sandbox manager.
- Artifact collector (logs/screenshots/traces/diffs).
- Retry and backoff queue for overloaded or flaky runs.

## 5.4 Data Layer

Core entities:
- Project.
- SourceManifest.
- ScenarioPack.
- ScenarioRun.
- FailureRecord.
- FixAttempt.
- PullRequestRecord.
- ReviewFinding.

Storage:
- Metadata DB (project state, runs, references).
- Object storage (artifacts).

## 6. Agent and Model Strategy

### 6.1 Sub-Agent Topology

1. Source Ingestion Agent.
2. Feature/Outcome Mapper Agent.
3. Scenario Research Agent.
4. Scenario Spec Agent.
5. Scenario Runner Agent.
6. Fix Planner Agent.
7. Fix Implementation Agent.
8. PR Authoring Agent.
9. Review and Recommendation Agent.

### 6.2 Model Assignment

Use `codex spark` for:
- Broad scenario research.
- Source synthesis.
- Feature/outcome grouping.
- Fast triage and lightweight drafting.

Use `gpt-5.3-xhigh` for:
- High-stakes implementation fixes.
- Complex refactors and regression-aware patches.
- PR rationale and reviewer-grade explanation.

### 6.3 Handoff Contracts

Each agent must read/write structured payloads:
- Input contract.
- Output contract.
- Confidence score.
- Uncertainty flags.
- Blocking reason when applicable.

## 7. Source Selection and Relevance Engine

Goal:
- Prevent stale docs from distorting scenario generation.

Signals:
- File modified age.
- Git divergence from active branch.
- Mention overlap between source text and current code symbols/routes.
- Contradiction hints across sources.

Relevance statuses:
- Trusted.
- Suspect.
- Stale.
- Excluded.

UX rules:
- Default preselect trusted sources.
- Default unselect stale sources when confidence is low.
- Show explicit warning banner before generation if stale sources are included.
- Require one-click user confirmation before proceeding.

Auditability:
- Persist exact source list and hashes per generation run.

## 8. Scenario Standards

Apply scenario quality bar from your scenario methodology:
- Real persona and intent.
- End-to-end realistic steps.
- Explicit preconditions and data.
- Expected checkpoints.
- Edge variants.
- Binary pass criteria.

Coverage baseline by product size:
- Small app: 8-12 scenarios.
- Medium: 12-20 scenarios.
- Large/multi-role: 20+ scenarios.

Grouping:
- Primary view: by feature.
- Secondary view: by user outcome.

## 9. Scenario Execution and Fix Loop

Run loop:
1. Execute scenario.
2. Record evidence.
3. Classify result.
4. Trigger fix pipeline on failure.
5. Generate patch.
6. Re-run impacted scenarios.
7. Open PR if pass criteria met.

PR strategy:
- Default one PR per scenario fix.
- Optional batching by feature for low-risk changes.

PR content requirements:
- Scenario IDs.
- Why it failed.
- What changed and why.
- Validation evidence.
- Residual risk and follow-up suggestions.

## 10. Auth and Security Plan

### 10.1 ChatGPT Sign-in

- Use Codex app server account methods for ChatGPT auth mode.
- Support managed browser flow and token refresh handling.
- Expose clear UI auth state and re-auth prompts.

### 10.2 GitHub Integration

Recommendation:
- Start with GitHub App for fine-grained permissions and short-lived tokens.
- Support user-to-server where needed for user-context actions.

Permissions baseline:
- Repository contents: read/write (for fixes/PR branches).
- Pull requests: read/write.
- Metadata: read.
- Webhooks for PR status sync.

### 10.3 Secrets and Safety

- No secrets committed.
- Secret storage in environment/managed vault.
- Least privilege scope by default.
- Audit log for all automated code changes.

## 11. UI/UX Standards (Challenge-Ready)

Design goals:
- Clean and fast.
- Single linear workflow with clear progress states.
- Human trust through transparent evidence.

Core screens:
1. Sign-in and repo connect.
2. Source selection + relevance warnings.
3. Scenario generation grouped view.
4. Live run dashboard.
5. Failure detail and fix actions.
6. PR board and review report.

Collaboration features:
- Multi-user comments per scenario.
- Assign owner per failed scenario.
- Team activity feed.

## 12. Delivery Phases

### Phase 0: Foundation (Day 1-2)

- RedwoodSDK app shell.
- Codex app server integration skeleton.
- Basic project model and persistence.

Exit criteria:
- Can create project and initialize Codex session.

### Phase 1: Auth + Repo Connect (Day 2-3)

- ChatGPT sign-in flow.
- GitHub App auth and repo import.

Exit criteria:
- User can sign in and connect a repo end-to-end.

### Phase 2: Source Relevance Gate (Day 3-4)

- Source discovery indexer.
- Selection/deselection UI.
- Relevance scoring and warnings.

Exit criteria:
- User can curate sources and confirm relevance.

### Phase 3: Scenario Generation (Day 4-5)

- Scenario pack generation through Codex app-server turns using `codex spark`.
- Grouping by feature/outcome.
- Persist `scenarios.md` and structured scenario JSON with source manifest + repo/branch/SHA linkage.
- Surface generated artifacts in UI with explicit download actions.

Exit criteria:
- User gets high-volume, structured, testable scenarios.
- Generation execution is performed by Codex app-server (not by UI client code).
- Generated artifacts are persisted in backend storage and are downloadable from the UI.

### Phase 4: Run Engine + Observability (Day 5-6)

- Scenario run orchestration.
- Live status streaming.
- Evidence capture and failure records.

Exit criteria:
- User can run scenario sets and inspect rich failure output.

### Phase 5: Auto-Fix + PR Creation (Day 6-7)

- Fix pipeline with `gpt-5.3-xhigh`.
- Branching and PR opening.
- Re-run gate before PR finalization.

Exit criteria:
- Failed scenario can auto-produce PR with proof.

### Phase 6: Review Board + Final Story (Day 7-8)

- Cross-run analytics.
- Improvement recommendations.
- Exportable challenge report and polished README narrative.

Exit criteria:
- Judge-ready end-to-end demo and documentation.

## 13. Acceptance Criteria

Product acceptance:
- User can complete full flow without manual backend intervention.
- Scenario generation supports max practical coverage from selected sources.
- Source deselection reliably affects generation output.
- At least one failed scenario can be auto-fixed into a valid PR.
- Review board explains improvements with evidence.

Technical acceptance:
- Deterministic run records per scenario execution.
- Retries and overload handling for app-server calls.
- No plaintext secrets in repo.
- Clear observability for agent decisions and handoffs.

## 14. Risks and Mitigations

Risk: stale docs produce wrong scenarios.
Mitigation: source relevance gate + explicit user confirmation + audit manifest.

Risk: model over-fixes causing regressions.
Mitigation: constrained diff scope + targeted re-runs + reviewer agent checks.

Risk: auth complexity stalls implementation.
Mitigation: lock auth decisions early and ship with one blessed path first.

Risk: PR noise overload.
Mitigation: default one PR per scenario, optional intelligent batching.

Risk: runtime cost spikes.
Mitigation: `codex spark` for broad work, reserve `gpt-5.3-xhigh` for hard fixes only.

## 15. Build Readiness Checklist

- Core architecture approved.
- Auth decisions approved (ChatGPT + GitHub App).
- Source relevance UX approved.
- Sub-agent contracts approved.
- Scenario schema approved.
- PR template and review rubric approved.
- README challenge narrative drafted.

## 16. References

OpenAI / Codex:
- Codex App Server docs: https://developers.openai.com/codex/app-server/
- Codex Authentication docs: https://developers.openai.com/codex/auth/

RedwoodSDK:
- RedwoodSDK docs home: https://docs.rwsdk.com/
- RedwoodSDK quick start: https://docs.rwsdk.com/getting-started/quick-start/
- RedwoodSDK framework site: https://rwsdk.com/

GitHub Auth and App Model:
- Authorizing OAuth apps: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- About creating GitHub Apps: https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/about-creating-github-apps
- Authentication with GitHub Apps: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app

## 17. Reusable Build Prompt

Implement ScenarioForge end-to-end using this plan: ChatGPT sign-in, GitHub repository connect, source relevance gate with select/deselect and staleness warnings, max scenario generation grouped by feature/outcome, scenario execution with live progress, auto-fix for failures, PR creation per fix, and a detailed review board with evidence and recommendations. Use `codex spark` for scenario research/synthesis and `gpt-5.3-xhigh` for implementation/fix steps.
