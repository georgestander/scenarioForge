# ScenarioForge

![ScenarioForge Cover](public/scenarioForge.png)

Scenario-first collaboration platform for builders who want concrete, real-world quality checks instead of abstract test noise.

## Why This Exists

We started from a challenge prompt: build a collaborative app using Codex.

The pain was clear:
- Conventional tests can feel abstract and disconnected from how users actually use products.
- Teams moving fast often have PRDs/specs/plans that drift from current code.
- This creates uncertainty about what should actually be validated.

The core idea we shaped together:
- Generate realistic scenarios from code + product docs.
- Let users select and deselect sources before generation.
- Run scenarios with visible progress and evidence.
- Auto-fix failures with Codex.
- Open PRs with scenario-linked proof.
- Present everything in a clean review board.

## Narrative Build-Up (How We Got Here)

1. Brainstormed a challenge-ready concept around collaboration and Codex-native workflows.
2. Identified scenario-based validation as the strongest differentiator for "vibe coding" teams.
3. Expanded from a simple demo into a full-flow product:
- ChatGPT sign-in
- GitHub repo connection
- Scenario generation and execution
- Auto-fix and PR creation
- Review and recommendations
4. Added a critical safeguard from real-world experience:
- users must be able to de-select outdated PRDs/specs/plans so stale docs do not corrupt scenario generation.
5. Locked model strategy:
- `codex spark` for scenario research and synthesis.
- `gpt-5.3-xhigh` for implementation-grade fixes.
6. Captured the full architecture and delivery plan in `docs/IMPLEMENTATION_PLAN.md`.

## What We Are Building

`ScenarioForge` (RedwoodSDK + Codex app-server) with:
- ChatGPT authentication
- GitHub integration
- Source relevance gate
- Feature/outcome grouped scenarios
- Live scenario runner
- Auto-fix pipeline
- PR generation
- Detailed collaborative review board

## How Codex Is Used

Codex is used for:
- Product architecture and scoping
- Scenario research and generation
- Failure analysis and fix planning
- Code implementation for scenario failures
- PR drafting and review insights

This project is intentionally designed so Codex is both:
- the collaboration partner in building the product, and
- the engine that powers the product workflow.

## Current Plan

See:
- `docs/IMPLEMENTATION_PLAN.md`
- `AGENTS.md`
- `.agent/POINTER.md`

## Local Development

### Prerequisites

- Node.js
- pnpm (recommended)

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev
```

## Security and Repo Hygiene

- Do not commit API keys or tokens.
- Use environment variables for secrets.
- Keep OAuth and token scopes least-privileged.

## Challenge Fit

This submission directly addresses the challenge requirements:
- Collaborative app: shared scenario run/review workflow.
- Meaningful Codex usage: generation, execution guidance, fixes, and review.
- Clear narrative of how Codex was used to shape and build the project.
