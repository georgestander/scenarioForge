import assert from "node:assert/strict";
import test from "node:test";
import { buildProject } from "../helpers/fixtures.ts";
import {
  scanSourcesForProject,
  scoreSource,
  validateGenerationSelection,
} from "@/services/sourceGate";

test("scanSourcesForProject returns typed records with mixed trust statuses", () => {
  const project = buildProject();
  const sources = scanSourcesForProject(project, project.ownerId, []);

  assert.ok(sources.length >= 8);
  assert.ok(sources.every((source) => source.projectId === project.id));
  assert.ok(sources.every((source) => source.type !== "code"));
  assert.ok(
    sources.every((source) => /\.(md|markdown|json|txt)$/i.test(source.path)),
  );
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
  );
  const oldDoc = scoreSource(
    "docs/PRD.md",
    "prd",
    new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    project,
  );

  assert.ok(freshCode > oldDoc);
});

test("validateGenerationSelection enforces non-empty selection and stale confirmation", () => {
  const project = buildProject();
  const sources = scanSourcesForProject(project, project.ownerId, []);
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

test("scanSourcesForProject is scoped to current project files only", () => {
  const project = buildProject({
    repoUrl: "https://github.com/acme/critical-repo",
  });
  const sources = scanSourcesForProject(project, project.ownerId);

  assert.ok(
    sources.every((source) => !/^[^/]+\/[^/]+\/docs\//.test(source.path)),
    "cross-repo source pattern should never appear",
  );
});
