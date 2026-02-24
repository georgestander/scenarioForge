import assert from "node:assert/strict";
import test from "node:test";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import { buildSourceManifest } from "@/services/sourceGate";
import {
  buildGeneratedScenarios,
  buildGeneratedOutput,
  buildProject,
  buildSelectedSources,
} from "../helpers/fixtures.ts";

test("buildSourceManifest links selected source IDs and hash", () => {
  const project = buildProject();
  const sources = buildSelectedSources(project, project.ownerId);
  const manifest = buildSourceManifest({
    ownerId: project.ownerId,
    projectId: project.id,
    selectedSources: sources,
    repositoryFullName: sources[0]?.repositoryFullName ?? "example/scenarioforge",
    branch: sources[0]?.branch ?? project.defaultBranch,
    headCommitSha: sources[0]?.headCommitSha ?? "unknown",
    userConfirmed: true,
    confirmationNote: "Test confirmation",
  });

  assert.equal(manifest.sourceIds.length, sources.length);
  assert.equal(manifest.userConfirmed, true);
  assert.ok(manifest.manifestHash.startsWith("h"));
});

test("generateScenarioPack returns contract-complete grouped scenarios", () => {
  const project = buildProject();
  const sources = buildSelectedSources(project, project.ownerId);
  const manifest = buildSourceManifest({
    ownerId: project.ownerId,
    projectId: project.id,
    selectedSources: sources,
    repositoryFullName: sources[0]?.repositoryFullName ?? "example/scenarioforge",
    branch: sources[0]?.branch ?? project.defaultBranch,
    headCommitSha: sources[0]?.headCommitSha ?? "unknown",
    userConfirmed: true,
    confirmationNote: "Test confirmation",
  });

  const pack = generateScenarioPack({
    project,
    ownerId: project.ownerId,
    manifest: { ...manifest, id: "smf_test", createdAt: "", updatedAt: "" },
    selectedSources: sources,
    model: "codex spark",
    rawOutput: buildGeneratedOutput(),
    metadata: {
      transport: "codex-app-server",
      requestedSkill: "scenario",
      usedSkill: "scenario",
      skillAvailable: true,
      skillPath: "/Users/example/.codex/skills/scenario/SKILL.md",
      threadId: "thr_test",
      turnId: "turn_test",
      turnStatus: "completed",
      cwd: "/tmp/scenarioforge",
    },
  });

  assert.ok(pack.scenarios.length > 0);
  assert.ok(pack.coverage.personas.length > 0);
  assert.ok(pack.coverage.journeys.length > 0);
  assert.equal(pack.coverage.uncoveredGaps.length, 0);
  assert.ok(Object.keys(pack.groupedByFeature).length > 0);
  assert.ok(Object.keys(pack.groupedByOutcome).length > 0);

  for (const scenario of pack.scenarios) {
    assert.ok(scenario.preconditions.length > 0);
    assert.ok(scenario.steps.length > 0);
    assert.ok(scenario.expectedCheckpoints.length > 0);
    assert.ok(scenario.edgeVariants.length > 0);
    assert.ok(scenario.passCriteria.length > 0);
  }
});

test("generateScenarioPack allows fewer than eight scenarios in code-first mode", () => {
  const previous = process.env.SCENARIO_CODE_FIRST_GENERATION;
  process.env.SCENARIO_CODE_FIRST_GENERATION = "1";
  try {
    const project = buildProject();
    const sources = buildSelectedSources(project, project.ownerId);
    const manifest = buildSourceManifest({
      ownerId: project.ownerId,
      projectId: project.id,
      selectedSources: sources,
      repositoryFullName: sources[0]?.repositoryFullName ?? "example/scenarioforge",
      branch: sources[0]?.branch ?? project.defaultBranch,
      headCommitSha: sources[0]?.headCommitSha ?? "unknown",
      userConfirmed: true,
      confirmationNote: "Test confirmation",
    });

    const minimalScenarios = buildGeneratedScenarios().slice(0, 3);
    const rawOutput = {
      scenarios: minimalScenarios,
      coverage: {
        personas: [...new Set(minimalScenarios.map((scenario) => scenario.persona))],
        journeys: minimalScenarios.map((scenario) => scenario.journey ?? scenario.title),
        edgeBuckets: ["validation", "permissions", "interruptions", "integration-failure"],
        features: [...new Set(minimalScenarios.map((scenario) => scenario.feature))],
        outcomes: [...new Set(minimalScenarios.map((scenario) => scenario.outcome))],
        assumptions: [],
        knownUnknowns: [],
        uncoveredGaps: [],
      },
      groupedByFeature: [
        {
          feature: minimalScenarios[0].feature,
          scenarioIds: minimalScenarios.map((scenario) => scenario.id),
        },
      ],
      groupedByOutcome: [
        {
          outcome: minimalScenarios[0].outcome,
          scenarioIds: minimalScenarios.map((scenario) => scenario.id),
        },
      ],
    };

    const pack = generateScenarioPack({
      project,
      ownerId: project.ownerId,
      manifest: { ...manifest, id: "smf_test_small", createdAt: "", updatedAt: "" },
      selectedSources: sources,
      model: "codex spark",
      rawOutput,
      metadata: {
        transport: "codex-app-server",
        requestedSkill: "scenario",
        usedSkill: "scenario",
        skillAvailable: true,
        skillPath: "/Users/example/.codex/skills/scenario/SKILL.md",
        threadId: "thr_test_small",
        turnId: "turn_test_small",
        turnStatus: "completed",
        cwd: "/tmp/scenarioforge",
      },
    });

    assert.equal(pack.scenarios.length, 3);
  } finally {
    process.env.SCENARIO_CODE_FIRST_GENERATION = previous ?? "0";
  }
});

test("generateScenarioPack accepts coverage notes without blocking generation", () => {
  const previous = process.env.SCENARIO_CODE_FIRST_GENERATION;
  process.env.SCENARIO_CODE_FIRST_GENERATION = "1";
  try {
    const project = buildProject();
    const sources = buildSelectedSources(project, project.ownerId);
    const manifest = buildSourceManifest({
      ownerId: project.ownerId,
      projectId: project.id,
      selectedSources: sources,
      repositoryFullName: sources[0]?.repositoryFullName ?? "example/scenarioforge",
      branch: sources[0]?.branch ?? project.defaultBranch,
      headCommitSha: sources[0]?.headCommitSha ?? "unknown",
      userConfirmed: true,
      confirmationNote: "Test confirmation",
    });

    const generatedOutput = buildGeneratedOutput();
    const rawOutput = {
      ...generatedOutput,
      coverage: {
        ...generatedOutput.coverage,
        uncoveredGaps: [
      "validation gap for malformed payload behavior remains unresolved",
        ],
      },
    };

    const pack = generateScenarioPack({
      project,
      ownerId: project.ownerId,
      manifest: { ...manifest, id: "smf_test_gap", createdAt: "", updatedAt: "" },
      selectedSources: sources,
      model: "codex spark",
      rawOutput,
      metadata: {
        transport: "codex-app-server",
        requestedSkill: "scenario",
        usedSkill: "scenario",
        skillAvailable: true,
        skillPath: "/Users/example/.codex/skills/scenario/SKILL.md",
        threadId: "thr_test_gap",
        turnId: "turn_test_gap",
        turnStatus: "completed",
        cwd: "/tmp/scenarioforge",
      },
    });
    assert.ok(
      pack.coverage.uncoveredGaps.some((gap) =>
        gap.includes("validation gap for malformed payload behavior remains unresolved"),
      ),
    );
  } finally {
    process.env.SCENARIO_CODE_FIRST_GENERATION = previous ?? "0";
  }
});
