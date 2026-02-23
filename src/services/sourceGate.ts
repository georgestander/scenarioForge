import type {
  GitHubRepository,
  Project,
  SourceManifest,
  SourceRecord,
  SourceRelevanceStatus,
  SourceType,
} from "@/domain/models";

const SOURCE_CANDIDATES: Array<{ path: string; title: string; freshnessDays: number }> = [
  { path: "README.md", title: "Product README", freshnessDays: 1 },
  {
    path: "docs/IMPLEMENTATION_PLAN.md",
    title: "Implementation plan",
    freshnessDays: 1,
  },
  { path: "docs/ARCHITECTURE.md", title: "Architecture document", freshnessDays: 2 },
  {
    path: "docs/EXECUTION_BACKLOG.md",
    title: "Execution backlog",
    freshnessDays: 1,
  },
  { path: "docs/PRD.md", title: "Product requirements", freshnessDays: 4 },
  { path: "docs/SPEC.md", title: "Feature specification", freshnessDays: 4 },
  { path: "src/worker.tsx", title: "API routes and orchestration", freshnessDays: 0 },
  { path: "src/services/store.ts", title: "State and persistence model", freshnessDays: 0 },
  { path: "src/app/pages/welcome.tsx", title: "Primary UX workflow", freshnessDays: 0 },
  { path: "src/domain/models.ts", title: "Domain contracts", freshnessDays: 0 },
];

const now = () => Date.now();
const daysToMs = (days: number) => days * 24 * 60 * 60 * 1000;

const hashText = (input: string): string => {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return `h${(hash >>> 0).toString(16)}`;
};

const toIso = (timestampMs: number): string => new Date(timestampMs).toISOString();

const inferSourceType = (path: string): SourceType => {
  const normalized = path.toLowerCase();

  if (normalized.includes("prd")) {
    return "prd";
  }
  if (normalized.includes("spec")) {
    return "spec";
  }
  if (normalized.includes("plan") || normalized.includes("backlog")) {
    return "plan";
  }
  if (normalized.includes("architecture")) {
    return "architecture";
  }
  return "code";
};

const recencyScore = (lastModifiedAt: string): number => {
  const ageMs = Math.max(0, now() - new Date(lastModifiedAt).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageDays <= 1) {
    return 40;
  }
  if (ageDays <= 3) {
    return 30;
  }
  if (ageDays <= 7) {
    return 20;
  }
  return 8;
};

const typeScore = (type: SourceType): number => {
  switch (type) {
    case "prd":
      return 20;
    case "spec":
      return 18;
    case "plan":
      return 16;
    case "architecture":
      return 14;
    case "code":
      return 22;
  }
};

const repoMatchScore = (path: string, project: Project): number => {
  if (!project.repoUrl) {
    return 0;
  }

  const repoName = project.repoUrl.split("/").filter(Boolean).pop()?.toLowerCase();
  if (!repoName) {
    return 0;
  }

  const normalizedPath = path.toLowerCase();
  return normalizedPath.includes(repoName) ? 12 : 7;
};

export const scoreSource = (
  path: string,
  type: SourceType,
  lastModifiedAt: string,
  project: Project,
): number => {
  const score =
    recencyScore(lastModifiedAt) + typeScore(type) + repoMatchScore(path, project);

  return Math.max(0, Math.min(100, score));
};

const scoreToStatus = (score: number): SourceRelevanceStatus => {
  if (score >= 66) {
    return "trusted";
  }
  if (score >= 50) {
    return "suspect";
  }
  return "stale";
};

const buildWarnings = (
  status: SourceRelevanceStatus,
  type: SourceType,
  lastModifiedAt: string,
): string[] => {
  const warnings: string[] = [];
  const ageDays = Math.floor((now() - new Date(lastModifiedAt).getTime()) / daysToMs(1));

  if (status === "stale") {
    warnings.push(`Source appears stale (${ageDays} days since update).`);
  }

  if (status === "suspect") {
    warnings.push("Low-confidence source alignment; validate against code.");
  }

  if (type !== "code" && ageDays > 2) {
    warnings.push("Potential doc/code drift detected.");
  }

  return warnings;
};

const buildRepoCandidates = (repos: GitHubRepository[]): Array<{
  path: string;
  title: string;
  freshnessDays: number;
}> => {
  return repos.slice(0, 4).map((repo, index) => ({
    path: `${repo.fullName}/docs/SPEC-${index + 1}.md`,
    title: `${repo.fullName} linked repository spec`,
    freshnessDays: index + 1,
  }));
};

export const scanSourcesForProject = (
  project: Project,
  ownerId: string,
  repositories: GitHubRepository[],
): Omit<SourceRecord, "id" | "createdAt" | "updatedAt">[] => {
  const candidates = [...SOURCE_CANDIDATES, ...buildRepoCandidates(repositories)];

  return candidates.map((candidate) => {
    const type = inferSourceType(candidate.path);
    const lastModifiedAt = toIso(now() - daysToMs(candidate.freshnessDays));
    const relevanceScore = scoreSource(candidate.path, type, lastModifiedAt, project);
    const status = scoreToStatus(relevanceScore);
    const warnings = buildWarnings(status, type, lastModifiedAt);

    return {
      ownerId,
      projectId: project.id,
      path: candidate.path,
      title: candidate.title,
      type,
      lastModifiedAt,
      relevanceScore,
      status,
      selected: status !== "stale",
      warnings,
      hash: hashText(`${candidate.path}|${lastModifiedAt}|${relevanceScore}`),
    };
  });
};

export const validateGenerationSelection = (
  selectedSources: SourceRecord[],
  userConfirmed: boolean,
): { ok: true; includesStale: boolean } | { ok: false; error: string } => {
  if (selectedSources.length === 0) {
    return {
      ok: false,
      error: "Select at least one source before generation.",
    };
  }

  const includesStale = selectedSources.some((source) => source.status === "stale");

  if (includesStale && !userConfirmed) {
    return {
      ok: false,
      error:
        "Selected sources include stale entries. Confirm relevance explicitly before generation.",
    };
  }

  return {
    ok: true,
    includesStale,
  };
};

interface BuildManifestInput {
  ownerId: string;
  projectId: string;
  selectedSources: SourceRecord[];
  userConfirmed: boolean;
  confirmationNote: string;
}

export const buildSourceManifest = (
  input: BuildManifestInput,
): Omit<SourceManifest, "id" | "createdAt" | "updatedAt"> => {
  const statusCounts: SourceManifest["statusCounts"] = {
    trusted: 0,
    suspect: 0,
    stale: 0,
    excluded: 0,
  };

  input.selectedSources.forEach((source) => {
    statusCounts[source.status] += 1;
  });

  const sourceIds = input.selectedSources.map((source) => source.id);
  const sourceHashes = input.selectedSources.map((source) => source.hash);
  const includesStale = input.selectedSources.some(
    (source) => source.status === "stale",
  );
  const confirmedAt = input.userConfirmed ? new Date().toISOString() : null;

  return {
    ownerId: input.ownerId,
    projectId: input.projectId,
    sourceIds,
    sourceHashes,
    statusCounts,
    includesStale,
    userConfirmed: input.userConfirmed,
    confirmationNote: input.confirmationNote.trim(),
    confirmedAt,
    manifestHash: hashText(`${sourceHashes.join("|")}|${confirmedAt ?? "none"}`),
  };
};
