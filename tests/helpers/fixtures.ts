import type {
  Project,
  ScenarioPack,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import { buildSourceManifest } from "@/services/sourceGate";

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
  const timestamp = new Date().toISOString();
  const repositoryFullName = "example/scenarioforge";
  const branch = project.defaultBranch || "main";
  const headCommitSha = "1111111111111111111111111111111111111111";

  const docs = [
    {
      path: "README.md",
      title: "Readme",
      type: "plan" as const,
      status: "trusted" as const,
      relevanceScore: 82,
      alignmentScore: 64,
      isConflicting: false,
    },
    {
      path: "docs/IMPLEMENTATION_PLAN.md",
      title: "Implementation Plan",
      type: "plan" as const,
      status: "trusted" as const,
      relevanceScore: 79,
      alignmentScore: 58,
      isConflicting: false,
    },
    {
      path: "docs/ARCHITECTURE.md",
      title: "Architecture",
      type: "architecture" as const,
      status: "suspect" as const,
      relevanceScore: 55,
      alignmentScore: 18,
      isConflicting: true,
    },
    {
      path: "docs/EXECUTION_BACKLOG.md",
      title: "Execution Backlog",
      type: "plan" as const,
      status: "trusted" as const,
      relevanceScore: 76,
      alignmentScore: 46,
      isConflicting: false,
    },
    {
      path: "docs/PRD.md",
      title: "Prd",
      type: "prd" as const,
      status: "stale" as const,
      relevanceScore: 39,
      alignmentScore: 10,
      isConflicting: true,
    },
    {
      path: "docs/SPEC.md",
      title: "Spec",
      type: "spec" as const,
      status: "trusted" as const,
      relevanceScore: 75,
      alignmentScore: 42,
      isConflicting: false,
    },
  ];

  return docs.map((doc, index) => ({
    id: `src_${index + 1}`,
    ownerId,
    projectId: project.id,
    repositoryFullName,
    branch,
    headCommitSha,
    lastCommitSha: `commit_${index + 1}`,
    path: doc.path,
    title: doc.title,
    type: doc.type,
    lastModifiedAt: timestamp,
    alignmentScore: doc.alignmentScore,
    isConflicting: doc.isConflicting,
    relevanceScore: doc.relevanceScore,
    status: doc.status,
    selected: doc.status !== "stale",
    warnings: doc.isConflicting
      ? ["Potential conflict with current code symbols/routes."]
      : [],
    hash: `h${index + 1}`,
    createdAt: timestamp,
    updatedAt: timestamp,
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
