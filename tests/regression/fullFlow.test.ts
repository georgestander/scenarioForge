import assert from "node:assert/strict";
import test from "node:test";
import { createFixAttemptFromRun, createPullRequestFromFix } from "@/services/fixPipeline";
import { buildChallengeReport, buildReviewBoard } from "@/services/reviewBoard";
import { createScenarioRunRecord } from "@/services/runEngine";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import type { RepositorySnapshot } from "@/services/sourceGate";
import { buildSourceManifest, scanSourcesForProject } from "@/services/sourceGate";
import { buildGeneratedOutput } from "../helpers/fixtures.ts";
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

const buildSnapshot = (): RepositorySnapshot => ({
  repositoryFullName: "example/scenarioforge",
  branch: "main",
  headCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  codePaths: [
    "src/worker.tsx",
    "src/services/sourceGate.ts",
    "src/app/pages/welcome.tsx",
  ],
  docs: [
    {
      path: "docs/IMPLEMENTATION_PLAN.md",
      lastModifiedAt: new Date().toISOString(),
      lastCommitSha: "commit_plan",
      blobSha: "blob_plan",
      content: "Source trust gate and scenario generation map to current service routes.",
    },
    {
      path: "docs/ARCHITECTURE.md",
      lastModifiedAt: new Date().toISOString(),
      lastCommitSha: "commit_arch",
      blobSha: "blob_arch",
      content: "Worker API routes and service boundaries for source scanning and manifest validation.",
    },
    {
      path: "docs/PRD.md",
      lastModifiedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      lastCommitSha: "commit_prd_old",
      blobSha: "blob_prd",
      content: "Legacy workflow using abandoned modules.",
    },
  ],
});

test("phase2-6 flow persists source -> generation -> run -> fix -> review artifacts", async () => {
  const ownerId = `usr_${crypto.randomUUID()}`;
  const project = createProject({
    ownerId,
    name: "ScenarioForge Regression",
    repoUrl: "https://github.com/example/scenarioforge",
    defaultBranch: "main",
  });

  const scannedSources = await scanSourcesForProject(
    project,
    ownerId,
    [
      {
        id: 1,
        name: "scenarioforge",
        fullName: "example/scenarioforge",
        defaultBranch: "main",
        private: false,
        url: "https://github.com/example/scenarioforge",
      },
    ],
    {
      snapshot: buildSnapshot(),
    },
  );
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
    repositoryFullName: selectedSources[0]?.repositoryFullName ?? "example/scenarioforge",
    branch: selectedSources[0]?.branch ?? project.defaultBranch,
    headCommitSha: selectedSources[0]?.headCommitSha ?? "unknown",
    userConfirmed: true,
    confirmationNote: "Regression test confirmation.",
  });
  const manifest = createSourceManifest(manifestInput);
  assert.equal(listSourceManifestsForProject(ownerId, project.id).length, 1);

  const packInput = generateScenarioPack({
    project,
    ownerId,
    manifest,
    selectedSources,
    model: "codex spark",
    rawOutput: buildGeneratedOutput(),
    metadata: {
      transport: "codex-app-server",
      requestedSkill: "scenario",
      usedSkill: "scenario",
      skillAvailable: true,
      skillPath: "/Users/example/.codex/skills/scenario/SKILL.md",
      threadId: "thr_regression",
      turnId: "turn_regression",
      turnStatus: "completed",
      cwd: "/tmp/scenarioforge",
    },
  });
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
