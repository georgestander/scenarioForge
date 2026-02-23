import assert from "node:assert/strict";
import test from "node:test";
import { createFixAttemptFromRun, createPullRequestFromFix } from "@/services/fixPipeline";
import { buildChallengeReport, buildReviewBoard } from "@/services/reviewBoard";
import { createScenarioRunRecord } from "@/services/runEngine";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import { buildSourceManifest, scanSourcesForProject } from "@/services/sourceGate";
import {
  createFixAttempt,
  createProject,
  createPullRequestRecord,
  createScenarioPack,
  createScenarioRun,
  createSourceManifest,
  listFixAttemptsForProject,
  listPullRequestsForProject,
  listScenarioPacksForProject,
  listScenarioRunsForProject,
  listSourceManifestsForProject,
  listSourcesForProject,
  upsertProjectSources,
} from "@/services/store";

test("phase2-6 flow persists source -> generation -> run -> fix -> review artifacts", () => {
  const ownerId = `usr_${crypto.randomUUID()}`;
  const project = createProject({
    ownerId,
    name: "ScenarioForge Regression",
    repoUrl: "https://github.com/example/scenarioforge",
    defaultBranch: "main",
  });

  const scannedSources = scanSourcesForProject(project, ownerId, []);
  const storedSources = upsertProjectSources({
    ownerId,
    projectId: project.id,
    sources: scannedSources,
  });
  const selectedSources = storedSources.filter((source) => source.selected).slice(0, 6);
  assert.ok(selectedSources.length > 0);

  const manifestInput = buildSourceManifest({
    ownerId,
    projectId: project.id,
    selectedSources,
    userConfirmed: true,
    confirmationNote: "Regression test confirmation.",
  });
  const manifest = createSourceManifest(manifestInput);
  assert.equal(listSourceManifestsForProject(ownerId, project.id).length, 1);

  const packInput = generateScenarioPack(project, ownerId, manifest, selectedSources);
  const pack = createScenarioPack(packInput);
  assert.equal(listScenarioPacksForProject(ownerId, project.id).length, 1);

  const runInput = createScenarioRunRecord({
    ownerId,
    projectId: project.id,
    pack,
  });
  const run = createScenarioRun(runInput);
  assert.equal(listScenarioRunsForProject(ownerId, project.id).length, 1);
  assert.ok(run.summary.total > 0);

  const fixAttemptInput = createFixAttemptFromRun({
    ownerId,
    projectId: project.id,
    run,
  });
  const fixAttempt = createFixAttempt(fixAttemptInput);
  assert.equal(listFixAttemptsForProject(ownerId, project.id).length, 1);

  const pullRequestInput = createPullRequestFromFix({
    ownerId,
    projectId: project.id,
    fixAttempt,
  });
  const pullRequest = createPullRequestRecord(pullRequestInput);
  assert.equal(listPullRequestsForProject(ownerId, project.id).length, 1);
  assert.ok(["open", "blocked"].includes(pullRequest.status));

  const board = buildReviewBoard(
    project,
    listScenarioPacksForProject(ownerId, project.id),
    listScenarioRunsForProject(ownerId, project.id),
    listPullRequestsForProject(ownerId, project.id),
  );
  assert.ok(board.coverage.totalScenarios > 0);
  assert.ok(board.recommendations.length > 0);

  const report = buildChallengeReport(project, manifest, board, run);
  assert.match(report, /ScenarioForge Challenge Report/);
  assert.equal(listSourcesForProject(ownerId, project.id).length, storedSources.length);
});
