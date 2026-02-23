import { env } from "cloudflare:workers";
import type { Project, SourceManifest, SourceRecord } from "@/domain/models";

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

interface LoadedSource {
  path: string;
  status: SourceRecord["status"];
  isConflicting: boolean;
  relevanceScore: number;
  lastModifiedAt: string;
  content: string;
}

interface BridgeScenarioGenerateResponse {
  model: string;
  cwd: string;
  threadId: string;
  turnId: string;
  turnStatus: string;
  skillRequested: string;
  skillAvailable: boolean;
  skillUsed: string | null;
  skillPath: string | null;
  responseText: string;
  completedAt: string;
}

export interface CodexScenarioGenerationResult {
  model: string;
  cwd: string;
  threadId: string;
  turnId: string;
  turnStatus: string;
  skillRequested: string;
  skillAvailable: boolean;
  skillUsed: string | null;
  skillPath: string | null;
  responseText: string;
  completedAt: string;
}

interface GenerateScenariosViaCodexInput {
  project: Project;
  manifest: SourceManifest;
  selectedSources: SourceRecord[];
  githubToken: string;
}

const MAX_PROMPT_SOURCES = 12;
const MAX_SOURCE_CHARS = 2400;

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/g, "");

const getBridgeUrl = (): string => {
  const base = env.CODEX_AUTH_BRIDGE_URL?.trim();

  if (!base) {
    throw new Error(
      "Codex app-server bridge is not configured. Set CODEX_AUTH_BRIDGE_URL before generating scenarios.",
    );
  }

  return trimTrailingSlash(base);
};

const readBridgeError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Bridge request failed with status ${response.status}.`;
  } catch {
    return `Bridge request failed with status ${response.status}.`;
  }
};

const bridgeFetchJson = async <T>(
  path: string,
  init: RequestInit,
): Promise<T> => {
  const response = await fetch(`${getBridgeUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readBridgeError(response));
  }

  return (await response.json()) as T;
};

const encodePathForGitHub = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const githubHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ScenarioForge",
});

const decodeBase64Content = (payload: GitHubContentResponse): string => {
  if (!payload.content || payload.encoding !== "base64") {
    return "";
  }

  try {
    return atob(payload.content.replace(/\n/g, ""));
  } catch {
    return "";
  }
};

const fetchSourceContent = async (
  repositoryFullName: string,
  branch: string,
  path: string,
  githubToken: string,
): Promise<string> => {
  const response = await fetch(
    `https://api.github.com/repos/${repositoryFullName}/contents/${encodePathForGitHub(
      path,
    )}?ref=${encodeURIComponent(branch)}`,
    {
      method: "GET",
      headers: githubHeaders(githubToken),
    },
  );

  if (!response.ok) {
    return "";
  }

  const payload = (await response.json()) as GitHubContentResponse;
  return decodeBase64Content(payload);
};

const loadSelectedSources = async (
  manifest: SourceManifest,
  selectedSources: SourceRecord[],
  githubToken: string,
): Promise<LoadedSource[]> => {
  const prioritized = [...selectedSources]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, MAX_PROMPT_SOURCES);

  const loaded = await Promise.all(
    prioritized.map(async (source) => ({
      path: source.path,
      status: source.status,
      isConflicting: source.isConflicting,
      relevanceScore: source.relevanceScore,
      lastModifiedAt: source.lastModifiedAt,
      content: await fetchSourceContent(
        manifest.repositoryFullName,
        manifest.branch,
        source.path,
        githubToken,
      ),
    })),
  );

  return loaded;
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n... [truncated]`;
};

const recommendedScenarioCount = (selectedCount: number): number =>
  Math.max(8, Math.min(24, Math.round(selectedCount * 1.7) + 4));

const buildSourceSection = (sources: LoadedSource[]): string => {
  if (sources.length === 0) {
    return "No source content could be loaded from GitHub for the selected manifest.";
  }

  return sources
    .map((source, index) => {
      const metadata = [
        `status=${source.status}`,
        `relevance=${source.relevanceScore}`,
        `conflicting=${source.isConflicting ? "yes" : "no"}`,
        `lastModifiedAt=${source.lastModifiedAt}`,
      ].join(", ");
      const content = source.content.trim().length
        ? truncate(source.content.trim(), MAX_SOURCE_CHARS)
        : "[content unavailable from GitHub API]";

      return [
        `Source ${index + 1}: ${source.path}`,
        `Metadata: ${metadata}`,
        "Content:",
        "```text",
        content,
        "```",
      ].join("\n");
    })
    .join("\n\n");
};

export const SCENARIO_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios", "groupedByFeature", "groupedByOutcome"],
  properties: {
    summary: {
      type: "string",
    },
    scenarios: {
      type: "array",
      minItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "feature",
          "outcome",
          "title",
          "persona",
          "preconditions",
          "testData",
          "steps",
          "expectedCheckpoints",
          "edgeVariants",
          "passCriteria",
          "priority",
        ],
        properties: {
          id: { type: "string" },
          feature: { type: "string" },
          outcome: { type: "string" },
          title: { type: "string" },
          persona: { type: "string" },
          preconditions: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          testData: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          steps: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          expectedCheckpoints: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          edgeVariants: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          passCriteria: { type: "string" },
          priority: {
            type: "string",
            enum: ["critical", "high", "medium"],
          },
        },
      },
    },
    groupedByFeature: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: { type: "string" },
      },
    },
    groupedByOutcome: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

const buildScenarioPrompt = (
  input: GenerateScenariosViaCodexInput,
  loadedSources: LoadedSource[],
): string => {
  const scenarioCount = recommendedScenarioCount(input.selectedSources.length);
  const sourcePaths = input.selectedSources.map((source) => source.path).join("\n- ");

  return [
    "Generate realistic end-to-end user scenarios for ScenarioForge.",
    "",
    "Hard constraints:",
    `- Repository: ${input.manifest.repositoryFullName}`,
    `- Branch: ${input.manifest.branch}`,
    `- Head commit: ${input.manifest.headCommitSha}`,
    "- Use only selected planning/spec/task sources listed below.",
    "- Do not use deselected or unknown documents.",
    "- Scenario quality bar must align to the $scenario skill: realistic journeys, edge variants, binary pass criteria, and evidence-ready checkpoints.",
    `- Generate approximately ${scenarioCount} scenarios.`,
    "- Group scenarios by both feature and user outcome.",
    "- If source docs conflict with current code behavior, preserve current behavior and encode the conflict as edge variants/checkpoints.",
    "",
    "Selected source paths:",
    `- ${sourcePaths}`,
    "",
    "Return strict JSON only; no markdown and no code fences.",
    "",
    "Source excerpts:",
    buildSourceSection(loadedSources),
    "",
    "Context for naming and intent:",
    `- Project name: ${input.project.name}`,
    `- Manifest hash: ${input.manifest.manifestHash}`,
  ].join("\n");
};

export const generateScenariosViaCodex = async (
  input: GenerateScenariosViaCodexInput,
): Promise<CodexScenarioGenerationResult> => {
  const envWithWorkspace = env as unknown as Record<string, string | undefined>;
  const configuredWorkspaceCwd = envWithWorkspace.SCENARIOFORGE_WORKSPACE_CWD?.trim();
  const token = input.githubToken.trim();
  if (!token) {
    throw new Error("GitHub installation token is required for scenario generation.");
  }

  const loadedSources = await loadSelectedSources(
    input.manifest,
    input.selectedSources,
    token,
  );
  const prompt = buildScenarioPrompt(input, loadedSources);

  const payload = await bridgeFetchJson<BridgeScenarioGenerateResponse>(
    "/scenario/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model: "codex spark",
        skillName: "scenario",
        cwd: configuredWorkspaceCwd || undefined,
        approvalPolicy: "never",
        sandboxPolicy: {
          type: "workspaceWrite",
          networkAccess: true,
        },
        outputSchema: SCENARIO_OUTPUT_SCHEMA,
        prompt,
      }),
    },
  );

  if (!payload.responseText?.trim()) {
    throw new Error("Codex scenario generation returned an empty response payload.");
  }

  return {
    model: payload.model,
    cwd: payload.cwd,
    threadId: payload.threadId,
    turnId: payload.turnId,
    turnStatus: payload.turnStatus,
    skillRequested: payload.skillRequested,
    skillAvailable: payload.skillAvailable,
    skillUsed: payload.skillUsed,
    skillPath: payload.skillPath,
    responseText: payload.responseText,
    completedAt: payload.completedAt,
  };
};
