import { env } from "cloudflare:workers";
import type { Project, ScenarioPack } from "@/domain/models";

interface BridgeExecuteResponse {
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

export interface CodexExecutionResult {
  model: string;
  cwd: string;
  threadId: string;
  turnId: string;
  turnStatus: string;
  responseText: string;
  parsedOutput: unknown;
  completedAt: string;
}

interface ExecuteScenariosViaCodexInput {
  project: Project;
  pack: ScenarioPack;
  executionMode: "run" | "fix" | "pr" | "full";
  userInstruction?: string;
  constraints?: Record<string, unknown>;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/g, "");

const getBridgeUrl = (): string => {
  const base = env.CODEX_AUTH_BRIDGE_URL?.trim();

  if (!base) {
    throw new Error(
      "Codex app-server bridge is not configured. Set CODEX_AUTH_BRIDGE_URL before executing scenarios.",
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

const formatScenarioSummary = (pack: ScenarioPack): string =>
  pack.scenarios
    .slice(0, 24)
    .map((scenario) => {
      const checkpoints = scenario.expectedCheckpoints.slice(0, 3).join(" | ");
      return [
        `- ${scenario.id}: ${scenario.title}`,
        `  feature=${scenario.feature}; outcome=${scenario.outcome}; priority=${scenario.priority}`,
        `  passCriteria=${scenario.passCriteria}`,
        `  checkpoints=${checkpoints}`,
      ].join("\n");
    })
    .join("\n");

export const EXECUTE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["run"],
  properties: {
    run: {
      type: "object",
      additionalProperties: true,
      required: ["items", "summary"],
      properties: {
        status: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: true,
            required: ["scenarioId", "status", "observed", "expected"],
            properties: {
              scenarioId: { type: "string" },
              status: {
                type: "string",
                enum: ["passed", "failed", "blocked"],
              },
              observed: { type: "string" },
              expected: { type: "string" },
              failureHypothesis: { type: ["string", "null"] },
              artifacts: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                  required: ["kind", "label", "value"],
                  properties: {
                    kind: { type: "string" },
                    label: { type: "string" },
                    value: { type: "string" },
                  },
                },
              },
            },
          },
        },
        summary: {
          type: "object",
          additionalProperties: true,
          required: ["passed", "failed", "blocked"],
          properties: {
            passed: { type: "number" },
            failed: { type: "number" },
            blocked: { type: "number" },
          },
        },
      },
    },
    fixAttempt: {
      type: ["object", "null"],
      additionalProperties: true,
    },
    pullRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
} as const;

const buildExecutePrompt = (input: ExecuteScenariosViaCodexInput): string => {
  const userInstruction = input.userInstruction?.trim() || "";
  const constraints = input.constraints ? JSON.stringify(input.constraints) : "{}";

  return [
    "Execute ScenarioForge scenario loop in repository context and return strict JSON.",
    "",
    "Execution requirements:",
    `- Execution mode: ${input.executionMode}`,
    `- Repository: ${input.pack.repositoryFullName}`,
    `- Branch: ${input.pack.branch}`,
    `- Head commit: ${input.pack.headCommitSha}`,
    `- Scenario pack id: ${input.pack.id}`,
    `- Manifest id: ${input.pack.manifestId}`,
    "- Use available repo tools to run validation, apply targeted fixes, rerun impacted scenarios, and prepare PR metadata.",
    "- If a step cannot be executed in this environment, return that limitation in observed output and keep statuses accurate.",
    "",
    "Output contract:",
    "- Return strict JSON object with keys: run, fixAttempt, pullRequests.",
    "- run.items must include scenarioId, status, observed, expected, optional failureHypothesis and artifacts.",
    "- pullRequests entries should include title, url/status if available, scenarioIds, and riskNotes.",
    "",
    "Constraints:",
    constraints,
    "",
    userInstruction ? `User instruction: ${userInstruction}` : "User instruction: none",
    "",
    "Scenario subset:",
    formatScenarioSummary(input.pack),
  ].join("\n");
};

const parseRawOutput = (rawOutput: string): unknown => {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new Error("Codex execute action returned an empty response payload.");
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new Error("Codex execute action response was not valid JSON.");
  }
};

export const executeScenariosViaCodex = async (
  input: ExecuteScenariosViaCodexInput,
): Promise<CodexExecutionResult> => {
  const envWithWorkspace = env as unknown as Record<string, string | undefined>;
  const configuredWorkspaceCwd = envWithWorkspace.SCENARIOFORGE_WORKSPACE_CWD?.trim();

  const payload = await bridgeFetchJson<BridgeExecuteResponse>("/actions/execute", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.3-xhigh",
      skillName: "",
      cwd: configuredWorkspaceCwd || undefined,
      sandbox: "workspace-write",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        networkAccess: true,
      },
      outputSchema: EXECUTE_OUTPUT_SCHEMA,
      prompt: buildExecutePrompt(input),
    }),
  });

  const responseText =
    payload.responseText?.trim() ||
    (typeof payload.output === "string"
      ? payload.output.trim()
      : payload.output
        ? JSON.stringify(payload.output)
        : "");

  if (!responseText) {
    throw new Error("Codex execute action returned an empty response payload.");
  }

  return {
    model: payload.model,
    cwd: payload.cwd,
    threadId: payload.threadId,
    turnId: payload.turnId,
    turnStatus: payload.turnStatus,
    responseText,
    parsedOutput: parseRawOutput(responseText),
    completedAt: payload.completedAt,
  };
};
