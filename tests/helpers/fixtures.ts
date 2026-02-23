import type {
  Project,
  ScenarioContract,
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

export const buildGeneratedScenarios = (): ScenarioContract[] => {
  const base: Array<{
    feature: string;
    outcome: string;
    title: string;
    persona: string;
    priority: ScenarioContract["priority"];
  }> = [
    {
      feature: "Workspace Onboarding",
      outcome: "Connect repository context",
      title: "Sign in and connect GitHub installation",
      persona: "Solo builder",
      priority: "critical",
    },
    {
      feature: "Source Trust Gate",
      outcome: "Curate trusted docs",
      title: "Select trusted planning docs and confirm risk",
      persona: "QA lead",
      priority: "critical",
    },
    {
      feature: "Scenario Generation",
      outcome: "Generate grouped scenario pack",
      title: "Create feature and outcome grouped scenarios",
      persona: "Product engineer",
      priority: "high",
    },
    {
      feature: "Scenario Generation",
      outcome: "Review outcome coverage",
      title: "Inspect outcome grouping completeness",
      persona: "PM reviewer",
      priority: "medium",
    },
    {
      feature: "Run Engine",
      outcome: "Track execution progress",
      title: "Run scenarios with queued to completed transitions",
      persona: "Test operator",
      priority: "critical",
    },
    {
      feature: "Run Engine",
      outcome: "Capture actionable failures",
      title: "Inspect observed vs expected failure evidence",
      persona: "Debugging engineer",
      priority: "high",
    },
    {
      feature: "Auto-Fix",
      outcome: "Generate rerun-ready fixes",
      title: "Prepare auto-fix patch for failed scenarios",
      persona: "Maintainer",
      priority: "critical",
    },
    {
      feature: "Review Board",
      outcome: "Summarize release risk",
      title: "Review risks and recommendations before PR merge",
      persona: "Tech lead",
      priority: "high",
    },
  ];

  return base.map((item, index) => ({
    id: `scn_${String(index + 1).padStart(2, "0")}`,
    feature: item.feature,
    outcome: item.outcome,
    title: item.title,
    persona: item.persona,
    preconditions: ["Project exists", "Source manifest is confirmed"],
    testData: ["Repository metadata", "Selected source ids"],
    steps: [
      "Open ScenarioForge stage flow.",
      "Execute the stage action.",
      "Inspect resulting status and evidence.",
    ],
    expectedCheckpoints: [
      "State transition is persisted.",
      "Output includes traceable IDs.",
      "Evidence links are present and readable.",
    ],
    edgeVariants: [
      "Source data is stale or conflicting.",
      "External integration responds slowly.",
    ],
    passCriteria:
      "All checkpoints pass without unresolved errors and evidence is traceable.",
    priority: item.priority,
  }));
};

export const buildGeneratedOutput = () => {
  const scenarios = buildGeneratedScenarios();
  const groupedByFeature: Record<string, string[]> = {};
  const groupedByOutcome: Record<string, string[]> = {};

  scenarios.forEach((scenario) => {
    groupedByFeature[scenario.feature] = groupedByFeature[scenario.feature] ?? [];
    groupedByFeature[scenario.feature].push(scenario.id);

    groupedByOutcome[scenario.outcome] = groupedByOutcome[scenario.outcome] ?? [];
    groupedByOutcome[scenario.outcome].push(scenario.id);
  });

  return {
    scenarios,
    groupedByFeature,
    groupedByOutcome,
  };
};

export const buildPack = (
  project: Project,
  ownerId: string,
  manifest: SourceManifest,
  sources: SourceRecord[],
): ScenarioPack => {
  const pack = generateScenarioPack({
    project,
    ownerId,
    manifest,
    selectedSources: sources,
    model: "codex spark",
    rawOutput: buildGeneratedOutput(),
    metadata: {
      transport: "codex-app-server",
      requestedSkill: "scenario",
      usedSkill: "scenario",
      skillAvailable: true,
      skillPath: "/Users/example/.codex/skills/scenario/SKILL.md",
      threadId: "thr_fixture",
      turnId: "turn_fixture",
      turnStatus: "completed",
      cwd: "/tmp/scenarioforge",
      generatedAt: new Date().toISOString(),
    },
  });

  return {
    ...pack,
    id: `spk_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
