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

export interface CodexExecuteBridgeStreamEvent {
  event: string;
  payload: unknown;
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
  onEvent?: (event: CodexExecuteBridgeStreamEvent) => void,
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

const buildExecuteOutputSchema = (scenarioIds: string[]) => {
  const scenarioIdSchema =
    scenarioIds.length > 0
      ? { type: "string", enum: scenarioIds }
      : { type: "string" };

  return {
    type: "object",
    additionalProperties: false,
    required: ["run", "fixAttempt", "pullRequests"],
    properties: {
      run: {
        type: "object",
        additionalProperties: false,
        required: ["status", "items", "summary"],
        properties: {
          status: { type: "string" },
          items: {
            type: "array",
            minItems: Math.max(scenarioIds.length, 1),
            maxItems: Math.max(scenarioIds.length, 1),
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "scenarioId",
                "status",
                "observed",
                "expected",
                "failureHypothesis",
                "artifacts",
              ],
              properties: {
                scenarioId: scenarioIdSchema,
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
                    additionalProperties: false,
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
            additionalProperties: false,
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
        additionalProperties: false,
        required: [
          "failedScenarioIds",
          "probableRootCause",
          "patchSummary",
          "impactedFiles",
          "status",
          "rerunSummary",
        ],
        properties: {
          failedScenarioIds: {
            type: "array",
            items: { type: "string" },
          },
          probableRootCause: { type: "string" },
          patchSummary: { type: "string" },
          impactedFiles: {
            type: "array",
            items: { type: "string" },
          },
          status: { type: "string" },
          rerunSummary: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["passed", "failed", "blocked"],
            properties: {
              passed: { type: "number" },
              failed: { type: "number" },
              blocked: { type: "number" },
            },
          },
        },
      },
      pullRequests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "url",
            "status",
            "scenarioIds",
            "riskNotes",
            "branchName",
            "rootCauseSummary",
          ],
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            status: { type: "string" },
            scenarioIds: {
              type: "array",
              items: { type: "string" },
            },
            riskNotes: {
              type: "array",
              items: { type: "string" },
            },
            branchName: { type: "string" },
            rootCauseSummary: { type: "string" },
          },
        },
      },
    },
  } as const;
};

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
    "- Process scenarios sequentially in listed order and continue until every scenario reaches a terminal outcome.",
    "- Continue after failures: one failed scenario must not stop later scenarios from running.",
    "- Never leave long-running/watch commands in the foreground; use bounded checks and stop background processes before continuing.",
    "- If a step times out or cannot be executed, mark that scenario blocked and immediately continue to the next scenario.",
    "- Execute every scenario ID listed under Scenario subset and return one terminal run.items entry per scenario (`passed`/`failed`/`blocked`).",
    "- Do not stop early; if a scenario cannot be completed in this environment, mark it `blocked` with explicit observed reason.",
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
  return executeScenariosViaCodexInternal(input);
};

export const executeScenariosViaCodexStream = async (
  input: ExecuteScenariosViaCodexInput,
  onEvent?: (event: CodexExecuteBridgeStreamEvent) => void,
): Promise<CodexExecutionResult> => {
  return executeScenariosViaCodexInternal(input, onEvent);
};

const executeScenariosViaCodexInternal = async (
  input: ExecuteScenariosViaCodexInput,
  onEvent?: (event: CodexExecuteBridgeStreamEvent) => void,
): Promise<CodexExecutionResult> => {
  const envWithWorkspace = env as unknown as Record<string, string | undefined>;
  const configuredWorkspaceCwd = envWithWorkspace.SCENARIOFORGE_WORKSPACE_CWD?.trim();
  const scenarioIds = input.pack.scenarios.map((scenario) => scenario.id);
  const requestBody = {
    model: "gpt-5.3-xhigh",
    skillName: "",
    cwd: configuredWorkspaceCwd || undefined,
    sandbox: "workspace-write",
    approvalPolicy: "never",
    sandboxPolicy: {
      type: "workspaceWrite",
      networkAccess: true,
    },
    outputSchema: buildExecuteOutputSchema(scenarioIds),
    prompt: buildExecutePrompt(input),
  };

  const payload = onEvent
    ? await bridgeFetchStreamJson<BridgeExecuteResponse>(
        "/actions/execute/stream",
        {
          method: "POST",
          body: JSON.stringify(requestBody),
        },
        onEvent,
      )
    : await bridgeFetchJson<BridgeExecuteResponse>("/actions/execute", {
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
