import assert from "node:assert/strict";
import test from "node:test";
import { createPullRequestFromFix } from "@/services/fixPipeline";
import { buildChallengeReport, buildReviewBoard } from "@/services/reviewBoard";
import { createScenarioRunRecord } from "@/services/runEngine";
import { buildManifest, buildPack, buildProject, buildSelectedSources } from "../helpers/fixtures.ts";

test("buildReviewBoard aggregates coverage, risks, and recommendations", () => {
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
    id: "run_review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const pr = createPullRequestFromFix({
    ownerId: project.ownerId,
    projectId: project.id,
    fixAttempt: {
      id: "fix_review",
      ownerId: project.ownerId,
      projectId: project.id,
      scenarioRunId: run.id,
      failedScenarioIds: run.items.filter((item) => item.status === "failed").map((item) => item.scenarioId),
      probableRootCause: "Root cause",
      patchSummary: "Patch summary",
      impactedFiles: ["src/services/fixPipeline.ts"],
      model: "gpt-5.3-xhigh",
      status: "validated",
      rerunSummary: {
        runId: "run_rerun",
        passed: 5,
        failed: 0,
        blocked: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  const board = buildReviewBoard(project, [pack], [run], [
    {
      ...pr,
      id: "pr_review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

  assert.ok(board.coverage.totalScenarios > 0);
  assert.ok(board.runSummary.runs >= 1);
  assert.ok(board.recommendations.length > 0);
});

test("buildChallengeReport includes manifest hash and run summary", () => {
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
    id: "run_report",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const board = buildReviewBoard(project, [pack], [run], []);
  const report = buildChallengeReport(project, manifest, board, run);

  assert.match(report, /Manifest hash:/);
  assert.match(report, /Latest run:/);
});
