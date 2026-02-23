import assert from "node:assert/strict";
import test from "node:test";
import { buildProject } from "../helpers/fixtures.ts";
import type { RepositorySnapshot } from "@/services/sourceGate";
import {
  scanSourcesForProject,
  scoreSource,
  validateGenerationSelection,
} from "@/services/sourceGate";

const buildSnapshot = (
  repositoryFullName = "example/scenarioforge",
  projectBranch = "main",
): RepositorySnapshot => ({
  repositoryFullName,
  branch: projectBranch,
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
      lastCommitSha: "commit_new",
      blobSha: "blob_new",
      content:
        "Source relevance gate validates selected docs against current routes and services.",
    },
    {
      path: "docs/LEGACY_PLAN.md",
      lastModifiedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      lastCommitSha: "commit_old",
      blobSha: "blob_old",
      content: "Legacy PHP workflow and abandoned jQuery templates.",
    },
  ],
});

test("scanSourcesForProject returns repo-scoped records with trust statuses", async () => {
  const project = buildProject({
    repoUrl: "https://github.com/example/scenarioforge",
    defaultBranch: "main",
  });

  const sources = await scanSourcesForProject(project, project.ownerId, [
    {
      id: 1,
      name: "scenarioforge",
      fullName: "example/scenarioforge",
      defaultBranch: "main",
      private: false,
      url: "https://github.com/example/scenarioforge",
    },
  ], {
    snapshot: buildSnapshot("example/scenarioforge", "main"),
  });

  assert.equal(sources.length, 2);
  assert.ok(sources.every((source) => source.projectId === project.id));
  assert.ok(sources.every((source) => source.repositoryFullName === "example/scenarioforge"));
  assert.ok(sources.some((source) => source.status === "trusted"));
  assert.ok(sources.some((source) => source.status === "stale"));
});

test("scoreSource favors recent code over stale docs", () => {
  const project = buildProject();
  const freshCode = scoreSource(
    "src/worker.tsx",
    "code",
    new Date().toISOString(),
    project,
    70,
  );
  const oldDoc = scoreSource(
    "docs/PRD.md",
    "prd",
    new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    project,
    10,
  );

  assert.ok(freshCode > oldDoc);
});

test("validateGenerationSelection enforces explicit confirmation for risky sources", async () => {
  const project = buildProject({
    repoUrl: "https://github.com/example/scenarioforge",
    defaultBranch: "main",
  });
  const sources = await scanSourcesForProject(project, project.ownerId, [
    {
      id: 1,
      name: "scenarioforge",
      fullName: "example/scenarioforge",
      defaultBranch: "main",
      private: false,
      url: "https://github.com/example/scenarioforge",
    },
  ], {
    snapshot: buildSnapshot("example/scenarioforge", "main"),
  });

  const stale = sources.find((source) => source.status === "stale");
  assert.ok(stale);

  const emptyCheck = validateGenerationSelection([], false);
  assert.equal(emptyCheck.ok, false);

  const staleCheck = validateGenerationSelection(
    [
      {
        ...stale,
        id: "src_stale",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    false,
  );
  assert.equal(staleCheck.ok, false);

  const confirmedCheck = validateGenerationSelection(
    [
      {
        ...stale,
        id: "src_stale_confirmed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    true,
  );
  assert.equal(confirmedCheck.ok, true);
});

test("scanSourcesForProject is scoped to selected repository and branch", async () => {
  const project = buildProject({
    repoUrl: "https://github.com/acme/critical-repo",
    defaultBranch: "release/1.2.3",
  });

  const sources = await scanSourcesForProject(project, project.ownerId, [
    {
      id: 1,
      name: "critical-repo",
      fullName: "acme/critical-repo",
      defaultBranch: "main",
      private: true,
      url: "https://github.com/acme/critical-repo",
    },
  ], {
    snapshot: buildSnapshot("acme/critical-repo", "release/1.2.3"),
  });

  assert.ok(sources.every((source) => source.repositoryFullName === "acme/critical-repo"));
  assert.ok(sources.every((source) => source.branch === "release/1.2.3"));
});
