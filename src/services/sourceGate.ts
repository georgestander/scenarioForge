import type {
  GitHubRepository,
  Project,
  SourceManifest,
  SourceRecord,
  SourceRelevanceStatus,
  SourceType,
} from "@/domain/models";
import { isSelectableSourcePath } from "@/services/sourceSelection";

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

interface GitHubBranchResponse {
  name?: string;
  commit?: {
    sha?: string;
  };
}

interface GitHubCommitItem {
  sha?: string;
  commit?: {
    author?: {
      date?: string;
    };
    committer?: {
      date?: string;
    };
  };
}

interface GitHubContentResponse {
  sha?: string;
  encoding?: string;
  content?: string;
}

interface RepositoryDocSnapshot {
  path: string;
  lastModifiedAt: string;
  lastCommitSha: string | null;
  blobSha: string;
  content: string;
}

export interface RepositorySnapshot {
  repositoryFullName: string;
  branch: string;
  headCommitSha: string;
  docs: RepositoryDocSnapshot[];
  codePaths: string[];
}

interface ScanSourcesOptions {
  githubToken?: string | null;
  fetchImpl?: typeof fetch;
  snapshot?: RepositorySnapshot;
  strict?: boolean;
}

const CODE_FILE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rb",
  ".java",
  ".kt",
  ".swift",
];

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "over",
  "when",
  "then",
  "else",
  "todo",
  "tbd",
  "main",
  "index",
  "docs",
  "json",
  "text",
  "file",
  "path",
  "type",
  "user",
  "users",
  "data",
  "api",
  "route",
  "routes",
]);

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

const basename = (path: string): string =>
  path.split("/").filter(Boolean).pop() ?? path;

const titleFromPath = (path: string): string => {
  const raw = basename(path).replace(/\.[^.]+$/, "");
  return raw
    .split(/[-_.]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
};

const inferSourceType = (path: string): SourceType => {
  const normalized = path.toLowerCase();

  if (normalized.includes("prd")) {
    return "prd";
  }
  if (normalized.includes("spec")) {
    return "spec";
  }
  if (normalized.includes("plan") || normalized.includes("backlog") || normalized.includes("task")) {
    return "plan";
  }
  if (normalized.includes("architecture")) {
    return "architecture";
  }
  return "plan";
};

const tokenize = (value: string): string[] => {
  const withCamelBoundaries = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const rawTokens = withCamelBoundaries.match(/[A-Za-z][A-Za-z0-9/_-]{2,}/g) ?? [];
  const normalized: string[] = [];

  rawTokens.forEach((token) => {
    token
      .toLowerCase()
      .split(/[\/_-]/g)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3 && !TOKEN_STOPWORDS.has(part))
      .forEach((part) => normalized.push(part));
  });

  return normalized;
};

const isCodePath = (path: string): boolean => {
  const normalized = path.toLowerCase();
  return CODE_FILE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
};

const buildCodeSymbolSet = (codePaths: string[]): Set<string> => {
  const symbols = new Set<string>();

  codePaths.forEach((path) => {
    tokenize(path).forEach((token) => symbols.add(token));
  });

  return symbols;
};

const computeAlignment = (
  sourcePath: string,
  content: string,
  codeSymbols: Set<string>,
): { score: number; overlapRatio: number } => {
  const docTokens = new Set([...tokenize(sourcePath), ...tokenize(content)]);

  if (docTokens.size === 0 || codeSymbols.size === 0) {
    return { score: 0, overlapRatio: 0 };
  }

  let overlapCount = 0;
  docTokens.forEach((token) => {
    if (codeSymbols.has(token)) {
      overlapCount += 1;
    }
  });

  const overlapRatio = overlapCount / docTokens.size;
  const score = Math.max(0, Math.min(100, Math.round(overlapRatio * 250)));

  return { score, overlapRatio };
};

const recencyScore = (lastModifiedAt: string): number => {
  const ageMs = Math.max(0, now() - new Date(lastModifiedAt).getTime());
  const ageDays = ageMs / daysToMs(1);

  if (ageDays <= 3) {
    return 40;
  }
  if (ageDays <= 14) {
    return 30;
  }
  if (ageDays <= 30) {
    return 20;
  }
  if (ageDays <= 60) {
    return 10;
  }
  return 4;
};

const typeScore = (type: SourceType): number => {
  switch (type) {
    case "prd":
      return 16;
    case "spec":
      return 18;
    case "plan":
      return 14;
    case "architecture":
      return 12;
    case "code":
      return 0;
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

  return path.toLowerCase().includes(repoName) ? 10 : 5;
};

export const scoreSource = (
  path: string,
  type: SourceType,
  lastModifiedAt: string,
  project: Project,
  alignmentScore = 50,
): number => {
  const score =
    recencyScore(lastModifiedAt) +
    typeScore(type) +
    repoMatchScore(path, project) +
    Math.round(Math.max(0, Math.min(100, alignmentScore)) * 0.3);

  return Math.max(0, Math.min(100, score));
};

const scoreToStatus = (score: number): SourceRelevanceStatus => {
  if (score >= 70) {
    return "trusted";
  }
  if (score >= 50) {
    return "suspect";
  }
  return "stale";
};

const parseRepoFullName = (repoUrl: string | null): string | null => {
  if (!repoUrl) {
    return null;
  }

  try {
    const url = new URL(repoUrl);
    return url.pathname.replace(/^\/+/g, "").replace(/\.git$/i, "");
  } catch {
    return null;
  }
};

const resolveProjectRepository = (
  project: Project,
  repositories: GitHubRepository[],
): GitHubRepository | null => {
  const fullName = parseRepoFullName(project.repoUrl);

  if (!fullName) {
    return null;
  }

  return (
    repositories.find(
      (repository) => repository.fullName.toLowerCase() === fullName.toLowerCase(),
    ) ?? null
  );
};

const githubHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ScenarioForge",
});

const readGitHubError = async (response: Response): Promise<string> => {
  const body = await response.text();

  try {
    const payload = JSON.parse(body) as { message?: string };
    return payload.message ?? body;
  } catch {
    return body;
  }
};

const githubGet = async <T>(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<T> => {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method: "GET",
    headers: githubHeaders(token),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub source scan request failed (${response.status}): ${await readGitHubError(response)}`,
    );
  }

  return (await response.json()) as T;
};

const decodeContent = (payload: GitHubContentResponse): string => {
  if (!payload.content || payload.encoding !== "base64") {
    return "";
  }

  try {
    return atob(payload.content.replace(/\n/g, ""));
  } catch {
    return "";
  }
};

const encodePathForGitHub = (path: string): string =>
  path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }

  const output = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return output;
};

const buildRepositorySnapshotFromGitHub = async (
  project: Project,
  repositories: GitHubRepository[],
  githubToken: string,
  fetchImpl: typeof fetch,
): Promise<RepositorySnapshot> => {
  const repository = resolveProjectRepository(project, repositories);

  if (!repository) {
    throw new Error(
      "Selected project repository is not available in the connected GitHub installation.",
    );
  }

  const branch = project.defaultBranch || repository.defaultBranch || "main";
  const branchResponse = await githubGet<GitHubBranchResponse>(
    `/repos/${repository.fullName}/branches/${encodeURIComponent(branch)}`,
    githubToken,
    fetchImpl,
  );
  const headCommitSha = String(branchResponse.commit?.sha ?? "").trim();

  if (!headCommitSha) {
    throw new Error(`Unable to resolve branch head commit for ${repository.fullName}:${branch}.`);
  }

  const treeResponse = await githubGet<GitHubTreeResponse>(
    `/repos/${repository.fullName}/git/trees/${encodeURIComponent(headCommitSha)}?recursive=1`,
    githubToken,
    fetchImpl,
  );
  const fileEntries = (treeResponse.tree ?? []).filter((entry) => entry.type === "blob");

  const docEntries = fileEntries.filter((entry) => isSelectableSourcePath(entry.path));
  const codePaths = fileEntries
    .map((entry) => entry.path)
    .filter((path) => isCodePath(path));

  const docs = await mapWithConcurrency(docEntries, 6, async (entry) => {
    const commitItems = await githubGet<GitHubCommitItem[]>(
      `/repos/${repository.fullName}/commits?sha=${encodeURIComponent(
        branch,
      )}&path=${encodeURIComponent(entry.path)}&per_page=1`,
      githubToken,
      fetchImpl,
    );
    const latestCommit = commitItems[0];
    const lastModifiedAt =
      latestCommit?.commit?.author?.date ??
      latestCommit?.commit?.committer?.date ??
      new Date().toISOString();

    const contentPayload = await githubGet<GitHubContentResponse>(
      `/repos/${repository.fullName}/contents/${encodePathForGitHub(
        entry.path,
      )}?ref=${encodeURIComponent(branch)}`,
      githubToken,
      fetchImpl,
    );

    return {
      path: entry.path,
      lastModifiedAt,
      lastCommitSha: latestCommit?.sha ?? null,
      blobSha: contentPayload.sha ?? entry.sha,
      content: decodeContent(contentPayload),
    };
  });

  return {
    repositoryFullName: repository.fullName,
    branch,
    headCommitSha,
    docs,
    codePaths,
  };
};

const buildWarnings = (
  status: SourceRelevanceStatus,
  lastModifiedAt: string,
  isConflicting: boolean,
  overlapRatio: number,
): string[] => {
  const warnings: string[] = [];
  const ageDays = Math.floor((now() - new Date(lastModifiedAt).getTime()) / daysToMs(1));

  if (status === "stale") {
    warnings.push(`Source appears stale (${ageDays} days since update).`);
  }

  if (isConflicting) {
    warnings.push(
      "Potential conflict with current code symbols/routes. Review before scenario generation.",
    );
  }

  if (overlapRatio < 0.04) {
    warnings.push("Low document/code overlap detected.");
  }

  return warnings;
};

export const scanSourcesForProject = async (
  project: Project,
  ownerId: string,
  repositories: GitHubRepository[] = [],
  options: ScanSourcesOptions = {},
): Promise<Omit<SourceRecord, "id" | "createdAt" | "updatedAt">[]> => {
  const strict = options.strict ?? false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const githubToken = options.githubToken?.trim() ?? "";

  let snapshot = options.snapshot ?? null;

  if (!snapshot) {
    if (!githubToken) {
      if (strict) {
        throw new Error("GitHub installation token is required to scan repository sources.");
      }
      return [];
    }

    snapshot = await buildRepositorySnapshotFromGitHub(
      project,
      repositories,
      githubToken,
      fetchImpl,
    );
  }

  const codeSymbols = buildCodeSymbolSet(snapshot.codePaths);

  return snapshot.docs
    .filter((doc) => isSelectableSourcePath(doc.path))
    .map((doc) => {
      const type = inferSourceType(doc.path);
      const alignment = computeAlignment(doc.path, doc.content, codeSymbols);
      const relevanceScore = scoreSource(
        doc.path,
        type,
        doc.lastModifiedAt,
        project,
        alignment.score,
      );

      let status = scoreToStatus(relevanceScore);
      const ageMs = Math.max(0, now() - new Date(doc.lastModifiedAt).getTime());
      const ageDays = ageMs / daysToMs(1);
      const isConflicting = alignment.overlapRatio < 0.02;

      if (ageDays > 60) {
        status = "stale";
      } else if (isConflicting && status === "trusted") {
        status = "suspect";
      }

      const warnings = buildWarnings(
        status,
        doc.lastModifiedAt,
        isConflicting,
        alignment.overlapRatio,
      );

      return {
        ownerId,
        projectId: project.id,
        repositoryFullName: snapshot.repositoryFullName,
        branch: snapshot.branch,
        headCommitSha: snapshot.headCommitSha,
        lastCommitSha: doc.lastCommitSha,
        path: doc.path,
        title: titleFromPath(doc.path),
        type,
        lastModifiedAt: doc.lastModifiedAt,
        alignmentScore: alignment.score,
        isConflicting,
        relevanceScore,
        status,
        selected: status === "trusted",
        warnings,
        hash: hashText(
          [
            snapshot.repositoryFullName,
            snapshot.branch,
            snapshot.headCommitSha,
            doc.path,
            doc.blobSha,
            doc.lastCommitSha ?? "none",
            String(alignment.score),
            status,
          ].join("|"),
        ),
      };
    });
};

export const validateGenerationSelection = (
  selectedSources: SourceRecord[],
  userConfirmed: boolean,
):
  | { ok: true; includesStale: boolean; includesConflicts: boolean }
  | { ok: false; error: string } => {
  if (selectedSources.length === 0) {
    return {
      ok: false,
      error: "Select at least one source before generation.",
    };
  }

  const includesStale = selectedSources.some((source) => source.status === "stale");
  const includesConflicts = selectedSources.some((source) => source.isConflicting);

  if ((includesStale || includesConflicts) && !userConfirmed) {
    return {
      ok: false,
      error:
        "Selected sources include stale or conflicting entries. Confirm relevance explicitly before generation.",
    };
  }

  return {
    ok: true,
    includesStale,
    includesConflicts,
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
  const sourcePaths = input.selectedSources.map((source) => source.path);
  const sourceHashes = input.selectedSources.map((source) => source.hash);
  const includesStale = input.selectedSources.some(
    (source) => source.status === "stale",
  );
  const includesConflicts = input.selectedSources.some((source) => source.isConflicting);
  const confirmedAt = input.userConfirmed ? new Date().toISOString() : null;
  const anchorSource = input.selectedSources[0];
  const repositoryFullName = anchorSource?.repositoryFullName ?? "unknown";
  const branch = anchorSource?.branch ?? "unknown";
  const headCommitSha = anchorSource?.headCommitSha ?? "unknown";

  return {
    ownerId: input.ownerId,
    projectId: input.projectId,
    repositoryFullName,
    branch,
    headCommitSha,
    sourceIds,
    sourcePaths,
    sourceHashes,
    statusCounts,
    includesStale,
    includesConflicts,
    userConfirmed: input.userConfirmed,
    confirmationNote: input.confirmationNote.trim(),
    confirmedAt,
    manifestHash: hashText(
      `${repositoryFullName}|${branch}|${headCommitSha}|${sourceHashes.join("|")}|${confirmedAt ?? "none"}`,
    ),
  };
};
