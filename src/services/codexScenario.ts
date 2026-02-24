import { env } from "cloudflare:workers";
import type {
  CodeBaseline,
  Project,
  ScenarioPack,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import { isCodeFirstGenerationEnabled } from "@/services/featureFlags";

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
  action?: string;
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
  output?: unknown;
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
  codeBaseline?: CodeBaseline | null;
  githubToken: string;
  mode?: "initial" | "update";
  userInstruction?: string;
  existingPack?: ScenarioPack | null;
  useSkill?: boolean;
}

export interface CodexBridgeStreamEvent {
  event: string;
  payload: unknown;
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

const parseSsePayload = (raw: string): unknown => {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

const readStreamError = (payload: unknown): string => {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }

  return "Codex bridge stream failed.";
};

const bridgeFetchStreamJson = async <T>(
  path: string,
  init: RequestInit,
  onEvent?: (event: CodexBridgeStreamEvent) => void,
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

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    return (await response.json()) as T;
  }

  if (!response.body) {
    throw new Error("Codex bridge returned no stream body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let dataLines: string[] = [];
  let completedPayload: T | null = null;

  const dispatchEvent = () => {
    if (dataLines.length === 0) {
      currentEvent = "message";
      return;
    }

    const payload = parseSsePayload(dataLines.join("\n"));
    onEvent?.({
      event: currentEvent,
      payload,
    });

    if (currentEvent === "error") {
      throw new Error(readStreamError(payload));
    }

    if (currentEvent === "completed") {
      if (payload && typeof payload === "object" && "result" in payload) {
        completedPayload = (payload as { result: T }).result;
      } else {
        completedPayload = payload as T;
      }
    }

    currentEvent = "message";
    dataLines = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim() || "message";
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
        continue;
      }

      if (line === "") {
        dispatchEvent();
      }
    }
  }

  if (dataLines.length > 0) {
    dispatchEvent();
  }

  if (completedPayload === null) {
    throw new Error("Codex bridge stream ended before completion payload.");
  }

  return completedPayload;
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

const buildSourceSection = (
  sources: LoadedSource[],
  hasSelectedSources: boolean,
): string => {
  if (!hasSelectedSources) {
    return [
      "No planning documents were selected.",
      "Operate in code-only mode using repository behavior and runtime evidence as the source of truth.",
    ].join(" ");
  }

  if (sources.length === 0) {
    return "Selected source docs could not be loaded from GitHub. Fall back to repository code behavior and report assumptions explicitly.";
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

const LEGACY_SCENARIO_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios", "groupedByFeature", "groupedByOutcome"],
  properties: {
    scenarios: {
      type: "array",
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
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["feature", "scenarioIds"],
        properties: {
          feature: { type: "string" },
          scenarioIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
    groupedByOutcome: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outcome", "scenarioIds"],
        properties: {
          outcome: { type: "string" },
          scenarioIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const COVERAGE_FIRST_SCENARIO_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios", "coverage", "groupedByFeature", "groupedByOutcome"],
  properties: {
    scenarios: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "feature",
          "outcome",
          "title",
          "persona",
          "journey",
          "riskIntent",
          "preconditions",
          "testData",
          "steps",
          "expectedCheckpoints",
          "edgeVariants",
          "codeEvidenceAnchors",
          "passCriteria",
          "priority",
        ],
        properties: {
          id: { type: "string" },
          feature: { type: "string" },
          outcome: { type: "string" },
          title: { type: "string" },
          persona: { type: "string" },
          journey: { type: "string" },
          riskIntent: { type: "string" },
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
          codeEvidenceAnchors: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          sourceRefs: {
            type: "array",
            items: { type: "string" },
          },
          passCriteria: { type: "string" },
          priority: {
            type: "string",
            enum: ["critical", "high", "medium"],
          },
        },
      },
    },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: [
        "personas",
        "journeys",
        "edgeBuckets",
        "features",
        "outcomes",
        "assumptions",
        "knownUnknowns",
        "uncoveredGaps",
      ],
      properties: {
        personas: { type: "array", minItems: 1, items: { type: "string" } },
        journeys: { type: "array", minItems: 1, items: { type: "string" } },
        edgeBuckets: { type: "array", minItems: 1, items: { type: "string" } },
        features: { type: "array", minItems: 1, items: { type: "string" } },
        outcomes: { type: "array", minItems: 1, items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } },
        knownUnknowns: { type: "array", items: { type: "string" } },
        uncoveredGaps: { type: "array", items: { type: "string" } },
      },
    },
    groupedByFeature: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["feature", "scenarioIds"],
        properties: {
          feature: { type: "string" },
          scenarioIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
    groupedByOutcome: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outcome", "scenarioIds"],
        properties: {
          outcome: { type: "string" },
          scenarioIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export const SCENARIO_OUTPUT_SCHEMA = COVERAGE_FIRST_SCENARIO_OUTPUT_SCHEMA;

const getScenarioOutputSchema = () =>
  isCodeFirstGenerationEnabled()
    ? COVERAGE_FIRST_SCENARIO_OUTPUT_SCHEMA
    : LEGACY_SCENARIO_OUTPUT_SCHEMA;

const buildCodeBaselineSection = (codeBaseline?: CodeBaseline | null): string => {
  if (!codeBaseline) {
    return "Code baseline unavailable. Use repository behavior and explain assumptions explicitly.";
  }

  return [
    `Code baseline id: ${codeBaseline.id}`,
    `Code baseline hash: ${codeBaseline.baselineHash}`,
    `Code baseline generatedAt: ${codeBaseline.generatedAt}`,
    `Route map: ${codeBaseline.routeMap.join(" | ") || "none"}`,
    `API surface: ${codeBaseline.apiSurface.join(" | ") || "none"}`,
    `State transitions: ${codeBaseline.stateTransitions.join(" | ") || "none"}`,
    `Async boundaries: ${codeBaseline.asyncBoundaries.join(" | ") || "none"}`,
    `Domain entities: ${codeBaseline.domainEntities.join(" | ") || "none"}`,
    `Integrations: ${codeBaseline.integrations.join(" | ") || "none"}`,
    `Error paths: ${codeBaseline.errorPaths.join(" | ") || "none"}`,
    `Likely failure points: ${codeBaseline.likelyFailurePoints.join(" | ") || "none"}`,
    `Evidence anchors: ${codeBaseline.evidenceAnchors.join(" | ") || "none"}`,
  ].join("\n");
};

const buildScenarioPrompt = (
  input: GenerateScenariosViaCodexInput,
  loadedSources: LoadedSource[],
): string => {
  const codeFirstEnabled = isCodeFirstGenerationEnabled();
  const sourcePaths = input.selectedSources.map((source) => source.path).join("\n- ");
  const hasSelectedSources = input.selectedSources.length > 0;
  const mode = input.mode ?? "initial";
  const userInstruction = input.userInstruction?.trim() ?? "";
  const updateContext =
    mode === "update" && input.existingPack
      ? [
          "Update context:",
          `- Existing pack id: ${input.existingPack.id}`,
          `- Existing scenarios: ${input.existingPack.scenarios.length}`,
          `- Existing manifest id: ${input.existingPack.manifestId}`,
          userInstruction
            ? `- User update request: ${userInstruction}`
            : "- User update request: refresh and improve the current scenarios.",
        ].join("\n")
      : "Update context: none";

  return [
    codeFirstEnabled
      ? "Generate coverage-complete, code-first end-to-end user scenarios for ScenarioForge."
      : "Generate realistic end-to-end user scenarios for ScenarioForge.",
    "",
    "Hard constraints:",
    `- Generation mode: ${mode}`,
    `- Repository: ${input.manifest.repositoryFullName}`,
    `- Branch: ${input.manifest.branch}`,
    `- Head commit: ${input.manifest.headCommitSha}`,
    ...(hasSelectedSources
      ? [
          "- Use selected planning/spec/task sources listed below.",
          "- Do not use deselected documents.",
          "- If selected docs conflict with current code behavior, preserve current behavior and encode the conflict as edge variants/checkpoints.",
        ]
      : [
          "- No planning docs are selected. Use repository code and runtime behavior as the primary source of truth.",
          "- Make assumptions explicit in scenario checkpoints when docs are absent.",
        ]),
    "- Scenario quality bar must align to the $scenario skill: realistic journeys, edge variants, binary pass criteria, and evidence-ready checkpoints.",
    ...(codeFirstEnabled
      ? [
          "- Enumerate all materially distinct user journeys and edge variants discoverable from current code behavior.",
          "- Do not optimize for fixed scenario count; optimize for coverage completeness and closure.",
          "- Include a top-level coverage object with: personas, journeys, edgeBuckets, features, outcomes, assumptions, knownUnknowns, uncoveredGaps.",
          "- Each scenario must include journey, riskIntent, and codeEvidenceAnchors (file/function/route identifiers).",
          "- sourceRefs are optional and should only reference selected docs.",
          "- groupedByFeature must be an array of objects: { feature, scenarioIds[] }.",
          "- groupedByOutcome must be an array of objects: { outcome, scenarioIds[] }.",
        ]
      : [
          "- Group scenarios by both feature and user outcome.",
          "- groupedByFeature must be an array of objects: { feature, scenarioIds[] }.",
          "- groupedByOutcome must be an array of objects: { outcome, scenarioIds[] }.",
        ]),
    "- Return final output directly as JSON response text.",
    "- Do not call apply_patch or write files.",
    "",
    "Code baseline:",
    buildCodeBaselineSection(input.codeBaseline),
    "",
    "Selected source paths:",
    hasSelectedSources ? `- ${sourcePaths}` : "- none (code-only mode)",
    "",
    updateContext,
    "",
    "Return strict JSON only; no markdown and no code fences.",
    "",
    "Source excerpts:",
    buildSourceSection(loadedSources, hasSelectedSources),
    "",
    "Context for naming and intent:",
    `- Project name: ${input.project.name}`,
    `- Manifest hash: ${input.manifest.manifestHash}`,
  ].join("\n");
};

export const generateScenariosViaCodex = async (
  input: GenerateScenariosViaCodexInput,
): Promise<CodexScenarioGenerationResult> => {
  return generateScenariosViaCodexInternal(input);
};

export const generateScenariosViaCodexStream = async (
  input: GenerateScenariosViaCodexInput,
  onEvent?: (event: CodexBridgeStreamEvent) => void,
): Promise<CodexScenarioGenerationResult> => {
  return generateScenariosViaCodexInternal(input, onEvent);
};

const generateScenariosViaCodexInternal = async (
  input: GenerateScenariosViaCodexInput,
  onEvent?: (event: CodexBridgeStreamEvent) => void,
): Promise<CodexScenarioGenerationResult> => {
  const useSkill = input.useSkill ?? true;
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
  const requestBody = {
    model: "codex spark",
    skillName: useSkill ? "scenario" : "",
    cwd: configuredWorkspaceCwd || undefined,
    sandbox: "read-only",
    approvalPolicy: "never",
    sandboxPolicy: {
      type: "readOnly",
    },
    outputSchema: getScenarioOutputSchema(),
    prompt,
  };

  const payload = onEvent
    ? await bridgeFetchStreamJson<BridgeScenarioGenerateResponse>(
        "/actions/generate/stream",
        {
          method: "POST",
          body: JSON.stringify(requestBody),
        },
        onEvent,
      )
    : await bridgeFetchJson<BridgeScenarioGenerateResponse>("/actions/generate", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });

  const responseText =
    payload.responseText?.trim() ||
    (typeof payload.output === "string"
      ? payload.output.trim()
      : payload.output
        ? JSON.stringify(payload.output)
        : "");

  if (!responseText) {
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
    responseText,
    completedAt: payload.completedAt,
  };
};
