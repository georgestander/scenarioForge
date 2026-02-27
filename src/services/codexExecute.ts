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
  threadId?: string;
}

export interface CodexExecuteBridgeStreamEvent {
  event: string;
  payload: unknown;
}

interface ExecuteRunItemQuality {
  scenarioId: string;
  status: "passed" | "failed" | "blocked";
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
    "- Return terminal run.items outcomes for each scenario you were able to execute in this turn.",
    "- If a scenario cannot be completed due to environment/tool/auth constraints, set status=`blocked` with explicit observed limitation and continue.",
    "- If a step cannot be executed in this environment, return that limitation in observed output and keep statuses accurate.",
    "- For executionMode=full, include fixAttempt details for failures and open real pull request URLs for failed scenarios when tools/auth permit.",
    "- If PR creation is impossible in this environment, keep affected scenarios failed and explain the PR limitation in observed/failureHypothesis/riskNotes. Do not fabricate placeholder URLs.",
    "",
    "Output contract:",
    "- Return strict JSON object with keys: run, fixAttempt, pullRequests.",
    "- run.items must include scenarioId, status (`passed` | `failed` | `blocked`), observed, expected, optional failureHypothesis and artifacts.",
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getExecutionOutputContainer = (
  parsedOutput: unknown,
): Record<string, unknown> => {
  if (!isRecord(parsedOutput)) {
    return {};
  }

  if (isRecord(parsedOutput.run) || Array.isArray(parsedOutput.pullRequests)) {
    return parsedOutput;
  }

  if (isRecord(parsedOutput.result)) {
    return parsedOutput.result;
  }

  if (isRecord(parsedOutput.output)) {
    return parsedOutput.output;
  }

  return parsedOutput;
};

const readRunItemsForQuality = (parsedOutput: unknown): ExecuteRunItemQuality[] => {
  const outputContainer = getExecutionOutputContainer(parsedOutput);
  const runRecord = isRecord(outputContainer.run) ? outputContainer.run : null;
  if (!runRecord) {
    return [];
  }

  const rawItems = Array.isArray(runRecord.items) ? runRecord.items : null;
  if (!rawItems || rawItems.length === 0) {
    return [];
  }

  return rawItems
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const scenarioId = String(item.scenarioId ?? "").trim();
      const statusRaw = String(item.status ?? "").trim().toLowerCase();
      if (!scenarioId) {
        return null;
      }
      if (statusRaw !== "passed" && statusRaw !== "failed" && statusRaw !== "blocked") {
        return null;
      }

      return {
        scenarioId,
        status: statusRaw as "passed" | "failed" | "blocked",
      };
    })
    .filter((item): item is ExecuteRunItemQuality => Boolean(item));
};

const evaluateExecuteOutputQuality = (
  parsedOutput: unknown,
  scenarioIds: string[],
  _executionMode: "run" | "fix" | "pr" | "full",
): string | null => {
  const items = readRunItemsForQuality(parsedOutput);
  const uniqueScenarioIds = new Set(scenarioIds);
  const seen = new Set<string>();

  for (const item of items) {
    if (!uniqueScenarioIds.has(item.scenarioId)) {
      return `Run item referenced unknown scenarioId '${item.scenarioId}'.`;
    }
    if (seen.has(item.scenarioId)) {
      return `Run items contain duplicate scenarioId '${item.scenarioId}'.`;
    }
    seen.add(item.scenarioId);
  }

  return null;
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
    skillName: "scenario",
    cwd: configuredWorkspaceCwd || undefined,
    sandbox: "workspaceWrite",
    approvalPolicy: "never",
    sandboxPolicy: {
      type: "workspaceWrite",
      networkAccess: true,
    },
    ...(input.threadId ? { threadId: input.threadId } : {}),
    outputSchema: buildExecuteOutputSchema(scenarioIds),
    prompt: buildExecutePrompt(input),
  };

  const invoke = async (body: Record<string, unknown>) => {
    const payload = onEvent
      ? await bridgeFetchStreamJson<BridgeExecuteResponse>(
          "/actions/execute/stream",
          {
            method: "POST",
            body: JSON.stringify(body),
          },
          onEvent,
        )
      : await bridgeFetchJson<BridgeExecuteResponse>("/actions/execute", {
          method: "POST",
          body: JSON.stringify(body),
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

    const parsedOutput = parseRawOutput(responseText);
    return { payload, responseText, parsedOutput };
  };

  const result = await invoke(requestBody);
  const qualityIssue = evaluateExecuteOutputQuality(
    result.parsedOutput,
    scenarioIds,
    input.executionMode,
  );
  if (qualityIssue) {
    throw new Error(`Codex execute output failed quality checks. ${qualityIssue}`);
  }

  // Keep bridge behavior thin: parse once and persist concrete terminal outcomes.
  return {
    model: result.payload.model,
    cwd: result.payload.cwd,
    threadId: result.payload.threadId,
    turnId: result.payload.turnId,
    turnStatus: result.payload.turnStatus,
    responseText: result.responseText,
    parsedOutput: result.parsedOutput,
    completedAt: result.payload.completedAt,
  };
};
