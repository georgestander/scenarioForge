import type {
  Project,
  ScenarioPack,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import { buildSourceManifest, scanSourcesForProject } from "@/services/sourceGate";

export const buildProject = (overrides: Partial<Project> = {}): Project => {
  const timestamp = new Date().toISOString();

  return {
    id: overrides.id ?? `proj_${crypto.randomUUID()}`,
    ownerId: overrides.ownerId ?? `usr_${crypto.randomUUID()}`,
    name: overrides.name ?? "ScenarioForge",
    repoUrl: overrides.repoUrl ?? "https://github.com/example/scenarioforge",
    defaultBranch: overrides.defaultBranch ?? "main",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  };
};

export const buildSelectedSources = (
  project: Project,
  ownerId: string,
): SourceRecord[] => {
  const scanned = scanSourcesForProject(project, ownerId, []);

  return scanned
    .slice(0, 6)
    .map((source, index) => ({
      ...source,
      id: `src_${index + 1}`,
      selected: true,
      status: source.status === "excluded" ? "suspect" : source.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
};

export const buildManifest = (
  project: Project,
  ownerId: string,
  sources: SourceRecord[],
): SourceManifest => {
  const manifest = buildSourceManifest({
    ownerId,
    projectId: project.id,
    selectedSources: sources,
    userConfirmed: true,
    confirmationNote: "Validated for tests",
  });

  return {
    ...manifest,
    id: `smf_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const buildPack = (
  project: Project,
  ownerId: string,
  manifest: SourceManifest,
  sources: SourceRecord[],
): ScenarioPack => {
  const pack = generateScenarioPack(project, ownerId, manifest, sources);

  return {
    ...pack,
    id: `spk_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
