import assert from "node:assert/strict";
import test from "node:test";
import { captureFailureEvidence, createScenarioRunRecord } from "@/services/runEngine";
import { buildManifest, buildPack, buildProject, buildSelectedSources } from "../helpers/fixtures.ts";

test("captureFailureEvidence provides observed/expected plus artifacts", () => {
  const project = buildProject();
  const sources = buildSelectedSources(project, project.ownerId);
  const manifest = buildManifest(project, project.ownerId, sources);
  const pack = buildPack(project, project.ownerId, manifest, sources);
  const failure = captureFailureEvidence("run_seed", pack.scenarios[0]);

  assert.ok(failure.observed.length > 0);
  assert.ok(failure.expected.length > 0);
  assert.equal(failure.artifacts.length, 3);
});

test("createScenarioRunRecord creates deterministic run summary with failures", () => {
  const project = buildProject();
  const sources = buildSelectedSources(project, project.ownerId);
  const manifest = buildManifest(project, project.ownerId, sources);
  const pack = buildPack(project, project.ownerId, manifest, sources);
  const run = createScenarioRunRecord({
    ownerId: project.ownerId,
    projectId: project.id,
    pack,
  });

  assert.equal(run.summary.total, run.items.length);
  assert.ok(run.summary.failed >= 1);
  assert.ok(run.events.length >= run.items.length * 3);
});
