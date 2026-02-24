import assert from "node:assert/strict";
import test from "node:test";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import { buildSourceManifest } from "@/services/sourceGate";
import {
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

  assert.ok(pack.scenarios.length >= 8);
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
