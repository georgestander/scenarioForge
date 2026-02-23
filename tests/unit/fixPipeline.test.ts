import assert from "node:assert/strict";
import test from "node:test";
import { createFixAttemptFromRun, createPullRequestFromFix } from "@/services/fixPipeline";
import { createScenarioRunRecord } from "@/services/runEngine";
import { buildManifest, buildPack, buildProject, buildSelectedSources } from "../helpers/fixtures.ts";

test("createFixAttemptFromRun links failed scenarios with rerun summary", () => {
  const project = buildProject();
  const sources = buildSelectedSources(project, project.ownerId);
  const manifest = buildManifest(project, project.ownerId, sources);
  const pack = buildPack(project, project.ownerId, manifest, sources);
  const run = {
    ...createScenarioRunRecord({
      ownerId: project.ownerId,
      projectId: project.id,
      pack,
    }),
    id: "run_test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const attempt = createFixAttemptFromRun({
    ownerId: project.ownerId,
    projectId: project.id,
    run,
  });

  assert.ok(attempt.failedScenarioIds.length > 0);
  assert.ok(attempt.rerunSummary);
  assert.equal(attempt.status, "validated");
});

test("createPullRequestFromFix requires rerun evidence and opens when rerun is green", () => {
  const project = buildProject();
  const fixAttempt = {
    id: "fix_test",
    ownerId: project.ownerId,
    projectId: project.id,
    scenarioRunId: "run_test",
    failedScenarioIds: ["scn_1"],
    probableRootCause: "Root cause summary",
    patchSummary: "Patch summary",
    impactedFiles: ["src/services/runEngine.ts"],
    model: "gpt-5.3-xhigh",
    status: "validated" as const,
    rerunSummary: {
      runId: "run_rerun",
      passed: 4,
      failed: 0,
      blocked: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const pr = createPullRequestFromFix({
    ownerId: project.ownerId,
    projectId: project.id,
    fixAttempt,
  });

  assert.equal(pr.status, "open");
  assert.equal(pr.scenarioIds.length, 1);
  assert.ok(pr.rerunEvidenceSummary);
});
