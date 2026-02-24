import { render, route, layout, prefix } from "rwsdk/router";
import type { RouteMiddleware } from "rwsdk/router";
import type { RequestInfo } from "rwsdk/worker";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { Home } from "@/app/pages/home";
import { AppShell } from "@/app/layouts/AppShell";
import { DashboardPage } from "@/app/pages/dashboard";
import { ConnectPage } from "@/app/pages/connect";
import { SourcesPage } from "@/app/pages/sources";
import { GeneratePage } from "@/app/pages/generate";
import { ReviewPage } from "@/app/pages/review";
import { ExecutePage } from "@/app/pages/execute";
import { CompletedPage } from "@/app/pages/completed";
import type {
  AuthPrincipal,
  AuthSession,
  ExecutionJob,
  GitHubConnection,
  Project,
  ScenarioPack,
} from "@/domain/models";
import { createAuthSession, clearAuthSession, loadAuthSession, saveAuthSession } from "@/services/auth";
import {
  deleteProjectExecutionHistoryFromD1,
  persistCodeBaselineToD1,
  persistExecutionJobEventToD1,
  persistExecutionJobToD1,
  persistFixAttemptToD1,
  persistProjectPrReadinessToD1,
  hydrateCoreStateFromD1,
  persistPullRequestToD1,
  persistPrincipalToD1,
  persistScenarioPackToD1,
  persistScenarioRunToD1,
  persistSourceManifestToD1,
  persistSourceRecordToD1,
  persistGitHubConnectionToD1,
  persistProjectToD1,
  reconcilePrincipalIdentityInD1,
} from "@/services/durableCore";
import {
  cancelChatGptLogin,
  logoutChatGpt,
  readChatGptAccount,
  readChatGptLoginCompletion,
  startChatGptLogin,
} from "@/services/chatgptAuth";
import {
  executeScenariosViaCodex,
  executeScenariosViaCodexStream,
} from "@/services/codexExecute";
import {
  generateScenariosViaCodex,
  generateScenariosViaCodexStream,
} from "@/services/codexScenario";
import {
  connectGitHubInstallation,
  consumeGitHubConnectState,
  findRecoverableGitHubInstallationId,
  getGitHubInstallUrl,
  issueGitHubConnectState,
} from "@/services/githubApp";
import { evaluateProjectPrReadiness } from "@/services/prReadiness";
import { buildChallengeReport, buildReviewBoard } from "@/services/reviewBoard";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import {
  buildSourceManifest,
  scanSourcesAndCodeBaselineForProject,
  validateGenerationSelection,
} from "@/services/sourceGate";
import {
  deleteProjectExecutionHistory,
  createFixAttempt,
  createExecutionJob,
  createExecutionJobEvent,
  createPrincipal,
  createProject,
  createPullRequestRecord,
  createScenarioPack,
  createScenarioRun,
  createSourceManifest,
  disconnectGitHubConnectionForPrincipal,
  getCodeBaselineById,
  getExecutionJobById,
  getFixAttemptById,
  getGitHubConnectionForPrincipal,
  getLatestCodeBaselineForProject,
  getLatestGitHubConnectionForPrincipal,
  getLatestProjectPrReadinessForProject,
  getLatestSourceManifestForProject,
  getPrincipalById,
  getPullRequestById,
  getProjectByIdForOwner,
  getScenarioPackById,
  getScenarioRunById,
  getSourceManifestById,
  listActiveExecutionJobsForProject,
  listActiveExecutionJobsForOwner,
  listExecutionJobEvents,
  listFixAttemptsForProject,
  listPrincipals,
  listProjectsForOwner,
  listPullRequestsForProject,
  listScenarioPacksForProject,
  listScenarioRunsForProject,
  listSourceManifestsForProject,
  listSourcesForProject,
  updateSourceSelections,
  upsertGitHubConnection,
  upsertProjectCodeBaseline,
  upsertProjectPrReadinessCheck,
  upsertProjectRecord,
  upsertProjectSources,
  updateExecutionJob,
} from "@/services/store";

interface AuthContext {
  session: AuthSession | null;
  principal: AuthPrincipal | null;
}

export interface AppContext {
  auth?: AuthContext;
}

type AppRequestInfo = RequestInfo<any, AppContext>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const createSseResponse = (
  run: (emit: (event: string, payload: unknown) => void) => Promise<void>,
): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, payload: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`,
          ),
        );
      };

      void run(emit)
        .catch((error) => {
          emit("error", {
            error:
              error instanceof Error
                ? error.message
                : "Unknown streaming error.",
            timestamp: new Date().toISOString(),
          });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            // ignore double-close
          }
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};

const githubCallbackRedirect = (
  request: Request,
  status: "connected" | "error",
  errorCode?: string,
): Response => {
  const redirectUrl = new URL("/", request.url);
  redirectUrl.searchParams.set("github", status);

  if (errorCode) {
    redirectUrl.searchParams.set("githubError", errorCode);
  }

  return Response.redirect(redirectUrl.toString(), 302);
};

const parseJsonBody = async (
  request: Request,
): Promise<Record<string, unknown> | null> => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.floor(numeric);
};

const normalizeExecutionMode = (
  value: unknown,
): "run" | "fix" | "pr" | "full" => {
  const mode = String(value ?? "")
    .trim()
    .toLowerCase();
  if (mode === "run" || mode === "fix" || mode === "pr" || mode === "full") {
    return mode;
  }
  return "full";
};

const describeCodexExecuteProgress = (eventName: string): string => {
  const normalized = eventName.trim().toLowerCase();
  if (normalized.includes("commandexecution") || normalized.includes("exec_command")) {
    return "Running repository checks and validating behavior...";
  }
  if (normalized.includes("task_complete") || normalized.includes("completed")) {
    return "Summarizing scenario outcome...";
  }
  if (normalized.includes("error") || normalized.includes("failed")) {
    return "Handling an execution issue and collecting details...";
  }
  if (normalized.includes("token") || normalized.includes("usage")) {
    return "Analyzing progress and updating scenario state...";
  }
  return "Analyzing repository behavior for this scenario...";
};

const findMentionedScenarioId = (
  payload: unknown,
  scenarioIds: string[],
): string | null => {
  const text =
    typeof payload === "string"
      ? payload
      : (() => {
          try {
            return JSON.stringify(payload);
          } catch {
            return "";
          }
        })();

  if (!text) {
    return null;
  }

  const normalizedText = text.toLowerCase();
  for (const scenarioId of scenarioIds) {
    if (normalizedText.includes(scenarioId.toLowerCase())) {
      return scenarioId;
    }
  }
  return null;
};

const summarizeScenarioRunOutcome = (
  status: "queued" | "running" | "passed" | "failed" | "blocked",
  observed: string,
): string => {
  if (status === "queued") {
    return "Queued: waiting for execution slot.";
  }
  if (status === "running") {
    return "Running: scenario execution in progress.";
  }
  if (status === "passed") {
    return "Passed: checkpoints matched expected behavior.";
  }
  if (status === "failed") {
    return `Failed: ${observed || "behavior did not match expected checkpoints."}`;
  }
  return `Blocked: ${observed || "execution could not continue in this environment."}`;
};

const hasPlaceholderObservedText = (value: string): boolean =>
  /\b(queued after|queued behind|waiting for previous|pending previous|pending|not attempted|skipped due to previous|deferred after|placeholder|not in user subset|n\/a|not applicable)\b/i.test(
    value,
  );

const normalizeRunItemStatus = (value: unknown): "passed" | "failed" => {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if (status === "passed" || status === "failed") {
    return status;
  }
  return "failed";
};

const normalizePullRequestStatus = (
  value: unknown,
): "draft" | "open" | "merged" | "blocked" => {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if (status === "draft" || status === "open" || status === "merged" || status === "blocked") {
    return status;
  }
  return "blocked";
};

const normalizeFixAttemptStatus = (
  value: unknown,
): "planned" | "in_progress" | "validated" | "failed" => {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if (status === "planned" || status === "in_progress" || status === "validated" || status === "failed") {
    return status;
  }
  return "failed";
};

const normalizeArtifacts = (value: unknown): Array<{
  kind: "log" | "screenshot" | "trace";
  label: string;
  value: string;
}> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const rawKind = String(item.kind ?? "")
        .trim()
        .toLowerCase();
      const kind =
        rawKind === "log" || rawKind === "screenshot" || rawKind === "trace"
          ? rawKind
          : "log";
      const label = String(item.label ?? "").trim() || "Artifact";
      const artifactValue = String(item.value ?? "").trim();

      if (!artifactValue) {
        return null;
      }

      return {
        kind,
        label,
        value: artifactValue,
      };
    })
    .filter((item): item is { kind: "log" | "screenshot" | "trace"; label: string; value: string } => Boolean(item));
};

const EXECUTION_JOB_MAX_ACTIVE_PER_OWNER = 3;
const EXECUTION_JOB_EVENT_PAGE_LIMIT = 200;
const EXECUTION_JOB_STALE_AFTER_MS = 12 * 60 * 1000;
const EXECUTION_JOB_MAX_CODEX_EVENTS = 300;

type ExecutionJobEventStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "complete";

type ExecutionJobEventStage = "run" | "fix" | "rerun" | "pr" | null;

const normalizeExecutionJobEventStatus = (
  value: unknown,
  fallback: ExecutionJobEventStatus = "running",
): ExecutionJobEventStatus => {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    status === "queued" ||
    status === "running" ||
    status === "passed" ||
    status === "failed" ||
    status === "blocked" ||
    status === "complete"
  ) {
    return status;
  }
  return fallback;
};

const normalizeExecutionJobEventStage = (
  value: unknown,
): ExecutionJobEventStage => {
  const stage = String(value ?? "")
    .trim()
    .toLowerCase();
  if (stage === "run" || stage === "fix" || stage === "rerun" || stage === "pr") {
    return stage;
  }
  return null;
};

const inferExecutionJobStatusFromRun = (
  run: ReturnType<typeof createScenarioRun>,
): ExecutionJob["status"] => {
  if (run.summary.failed > 0) {
    return "failed";
  }
  return "completed";
};

type PullRequestCreateInput = Parameters<typeof createPullRequestRecord>[0];

const getExecutionOutputContainer = (
  parsedOutput: unknown,
): Record<string, unknown> => {
  if (!isRecord(parsedOutput)) {
    throw new Error("Codex execute output is not a JSON object.");
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

const buildScenarioRunInputFromCodexOutput = (
  ownerId: string,
  projectId: string,
  pack: ScenarioPack,
  parsedOutput: unknown,
) => {
  const now = new Date();
  const startedAt = now.toISOString();

  const scenariosById = new Map(pack.scenarios.map((scenario) => [scenario.id, scenario]));
  const outputContainer = getExecutionOutputContainer(parsedOutput);
  const runRecord = isRecord(outputContainer.run) ? outputContainer.run : null;
  const rawItems = runRecord && Array.isArray(runRecord.items) ? runRecord.items : [];
  const parsedItemMap = new Map<
    string,
    {
      scenarioId: string;
      status: "passed" | "failed";
      startedAt: string;
      completedAt: string;
      observed: string;
      expected: string;
      failureHypothesis: string | null;
      artifacts: Array<{ kind: "log" | "screenshot" | "trace"; label: string; value: string }>;
    }
  >();

  rawItems.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }

    const scenarioId = String(item.scenarioId ?? "").trim();
    const scenario = scenariosById.get(scenarioId);
    if (!scenario || parsedItemMap.has(scenarioId)) {
      return;
    }

    const timestamp = new Date(now.getTime() + index * 250).toISOString();
    const status = normalizeRunItemStatus(item.status);
    const observed = String(item.observed ?? "").trim() || "No observed output captured.";
    const expected = String(item.expected ?? "").trim() || scenario.passCriteria;
    const normalizedStatus = hasPlaceholderObservedText(observed) ? "failed" : status;
    const normalizedFailureHypothesis = hasPlaceholderObservedText(observed)
      ? "Codex output indicates this scenario was not fully executed; marked failed for explicit rerun."
      : item.failureHypothesis === null
        ? null
        : String(item.failureHypothesis ?? "").trim() || null;

    parsedItemMap.set(scenarioId, {
      scenarioId,
      status: normalizedStatus,
      startedAt: timestamp,
      completedAt: timestamp,
      observed,
      expected,
      failureHypothesis: normalizedFailureHypothesis,
      artifacts: normalizeArtifacts(item.artifacts),
    });
  });

  // Ensure every scenario reaches a terminal state even if Codex omits some run items.
  const items = pack.scenarios.map((scenario, index) => {
    const existing = parsedItemMap.get(scenario.id);
    if (existing) {
      return existing;
    }

    const timestamp = new Date(now.getTime() + index * 250).toISOString();
    return {
      scenarioId: scenario.id,
      status: "failed" as const,
      startedAt: timestamp,
      completedAt: timestamp,
      observed:
        "Codex execute output omitted this scenario result. Marked failed for explicit rerun.",
      expected: scenario.passCriteria,
      failureHypothesis: "Missing run item for scenario in Codex execute output.",
      artifacts: [],
    };
  });

  const computedSummary = items.reduce(
    (acc, item) => {
      if (item.status === "passed") {
        acc.passed += 1;
      } else {
        acc.failed += 1;
      }
      return acc;
    },
    { total: items.length, passed: 0, failed: 0, blocked: 0 as number },
  );
  const summary = {
    total: computedSummary.total,
    passed: computedSummary.passed,
    failed: computedSummary.failed,
    blocked: computedSummary.blocked,
  };

  const events = items.flatMap((item, index) => {
    const queuedAt = new Date(now.getTime() + index * 250).toISOString();
    const runningAt = new Date(now.getTime() + index * 250 + 60).toISOString();
    const completedAt = item.completedAt;

    return [
      {
        id: `evt_${item.scenarioId}_queued_${index}`,
        scenarioId: item.scenarioId,
        status: "queued" as const,
        message: `${item.scenarioId} queued`,
        timestamp: queuedAt,
      },
      {
        id: `evt_${item.scenarioId}_running_${index}`,
        scenarioId: item.scenarioId,
        status: "running" as const,
        message: `${item.scenarioId} running`,
        timestamp: runningAt,
      },
      {
        id: `evt_${item.scenarioId}_${item.status}_${index}`,
        scenarioId: item.scenarioId,
        status: item.status,
        message: `${item.scenarioId} ${item.status}`,
        timestamp: completedAt,
      },
    ];
  });

  return {
    ownerId,
    projectId,
    scenarioPackId: pack.id,
    status: "completed" as const,
    startedAt,
    completedAt: new Date(now.getTime() + items.length * 250 + 200).toISOString(),
    items,
    summary,
    events,
  };
};

const buildFixAttemptInputFromCodexOutput = (
  ownerId: string,
  projectId: string,
  run: ReturnType<typeof createScenarioRun>,
  parsedOutput: unknown,
) => {
  const failedScenarioIdsFromRun = run.items
    .filter((item) => item.status === "failed")
    .map((item) => item.scenarioId);

  if (failedScenarioIdsFromRun.length === 0) {
    return null;
  }

  const outputContainer = getExecutionOutputContainer(parsedOutput);
  const fixRecord = isRecord(outputContainer.fixAttempt) ? outputContainer.fixAttempt : null;

  if (!fixRecord) {
    return null;
  }

  const failedScenarioIds = readStringArray(fixRecord.failedScenarioIds);
  const impactedFiles = readStringArray(fixRecord.impactedFiles);
  const rerunSummaryRecord = isRecord(fixRecord.rerunSummary)
    ? fixRecord.rerunSummary
    : null;

  return {
    ownerId,
    projectId,
    scenarioRunId: run.id,
    failedScenarioIds:
      failedScenarioIds.length > 0 ? failedScenarioIds : failedScenarioIdsFromRun,
    probableRootCause:
      String(fixRecord.probableRootCause ?? "").trim() ||
      "Fix attempt generated from Codex execute output.",
    patchSummary:
      String(fixRecord.patchSummary ?? "").trim() ||
      "No patch summary returned from Codex.",
    impactedFiles,
    model: "gpt-5.3-xhigh",
    status: normalizeFixAttemptStatus(fixRecord.status),
    rerunSummary: rerunSummaryRecord
      ? {
          runId: run.id,
          passed: readNumber(rerunSummaryRecord.passed, 0),
          failed: readNumber(rerunSummaryRecord.failed, 0),
          blocked: readNumber(rerunSummaryRecord.blocked, 0),
        }
      : null,
  };
};

const buildPullRequestInputsFromCodexOutput = (
  ownerId: string,
  projectId: string,
  fixAttempt: ReturnType<typeof createFixAttempt> | null,
  parsedOutput: unknown,
) => {
  if (!fixAttempt) {
    return [] as PullRequestCreateInput[];
  }

  const outputContainer = getExecutionOutputContainer(parsedOutput);
  const pullRequests = Array.isArray(outputContainer.pullRequests)
    ? outputContainer.pullRequests
    : [];
  const rerunEvidenceSummary = fixAttempt.rerunSummary
    ? {
        passed: fixAttempt.rerunSummary.passed,
        failed: fixAttempt.rerunSummary.failed,
        blocked: fixAttempt.rerunSummary.blocked,
      }
    : null;

  const results = pullRequests
    .map((record) => {
      if (!isRecord(record)) {
        return null;
      }

      const scenarioIds = readStringArray(record.scenarioIds);
      const riskNotes = readStringArray(record.riskNotes);
      const title = String(record.title ?? "").trim();
      const url = String(record.url ?? "").trim();

      if (!title || !url) {
        return null;
      }

      return {
        ownerId,
        projectId,
        fixAttemptId: fixAttempt.id,
        scenarioIds:
          scenarioIds.length > 0 ? scenarioIds : fixAttempt.failedScenarioIds,
        title,
        branchName:
          String(record.branchName ?? "").trim() ||
          `scenariofix/${fixAttempt.id}`,
        url,
        status: normalizePullRequestStatus(record.status),
        rootCauseSummary:
          String(record.rootCauseSummary ?? "").trim() ||
          fixAttempt.probableRootCause,
        rerunEvidenceRunId: fixAttempt.rerunSummary?.runId ?? null,
        rerunEvidenceSummary,
        riskNotes,
      };
    })
    .filter(
      (
        record,
      ): record is PullRequestCreateInput => Boolean(record),
    );
  return results;
};

const resolveExecutionJobArtifacts = (ownerId: string, job: ExecutionJob) => {
  const run = job.runId ? getScenarioRunById(ownerId, job.runId) : null;
  const fixAttempt = job.fixAttemptId
    ? getFixAttemptById(ownerId, job.fixAttemptId)
    : null;
  const pullRequests = job.pullRequestIds
    .map((pullRequestId) => getPullRequestById(ownerId, pullRequestId))
    .filter(
      (record): record is NonNullable<ReturnType<typeof getPullRequestById>> =>
        Boolean(record),
    );

  return {
    run,
    fixAttempt,
    pullRequests,
  };
};

interface PersistExecutionJobEventInput {
  job: ExecutionJob;
  event: string;
  phase: string;
  status: unknown;
  message: string;
  scenarioId?: string | null;
  stage?: unknown;
  payload?: unknown;
  timestamp?: string;
}

const persistExecutionJobEvent = async (
  input: PersistExecutionJobEventInput,
) => {
  const liveJob = getExecutionJobById(input.job.ownerId, input.job.id);
  if (!liveJob) {
    return null;
  }

  const record = createExecutionJobEvent({
    jobId: liveJob.id,
    ownerId: liveJob.ownerId,
    projectId: liveJob.projectId,
    event: input.event,
    phase: input.phase,
    status: normalizeExecutionJobEventStatus(input.status),
    message: input.message.trim() || input.event,
    scenarioId: input.scenarioId ?? null,
    stage: normalizeExecutionJobEventStage(input.stage),
    payload: input.payload ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
  await persistExecutionJobEventToD1(record);
  return record;
};

const readNestedRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const extractExecutionJobEventMessage = (
  eventName: string,
  payload: unknown,
): string => {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  const record = readNestedRecord(payload);
  const nested = readNestedRecord(record?.payload);
  const deep = readNestedRecord(nested?.payload);

  const candidates = [
    record?.message,
    nested?.message,
    deep?.message,
    record?.error,
    nested?.error,
    deep?.error,
    nested?.event,
  ];
  const first = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return first ?? eventName;
};

const extractExecutionJobEventPhase = (
  eventName: string,
  payload: unknown,
): string => {
  const record = readNestedRecord(payload);
  const nested = readNestedRecord(record?.payload);
  const deep = readNestedRecord(nested?.payload);

  const candidates = [
    record?.phase,
    nested?.phase,
    deep?.phase,
    nested?.event,
  ];
  const first = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return first ?? eventName;
};

const extractExecutionJobEventScenarioId = (
  payload: unknown,
): string | null => {
  const record = readNestedRecord(payload);
  const nested = readNestedRecord(record?.payload);
  const deep = readNestedRecord(nested?.payload);

  const candidates = [
    record?.scenarioId,
    nested?.scenarioId,
    deep?.scenarioId,
  ];
  const first = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return first ?? null;
};

const extractExecutionJobEventStatus = (
  payload: unknown,
): ExecutionJobEventStatus => {
  const record = readNestedRecord(payload);
  const nested = readNestedRecord(record?.payload);
  const deep = readNestedRecord(nested?.payload);
  return normalizeExecutionJobEventStatus(
    record?.status ?? nested?.status ?? deep?.status,
    "running",
  );
};

const extractExecutionJobEventStage = (
  payload: unknown,
): ExecutionJobEventStage => {
  const record = readNestedRecord(payload);
  const nested = readNestedRecord(record?.payload);
  const deep = readNestedRecord(nested?.payload);
  return normalizeExecutionJobEventStage(
    record?.stage ?? nested?.stage ?? deep?.stage,
  );
};

const updateExecutionJobAndPersist = async (
  ownerId: string,
  jobId: string,
  updater: (job: ExecutionJob) => void,
): Promise<ExecutionJob | null> => {
  const next = updateExecutionJob(ownerId, jobId, updater);
  if (!next) {
    return null;
  }

  await persistExecutionJobToD1(next);
  return next;
};

const expireStaleExecutionJobs = async (
  ownerId: string,
  staleAfterMs = EXECUTION_JOB_STALE_AFTER_MS,
): Promise<ExecutionJob[]> => {
  const activeJobs = listActiveExecutionJobsForOwner(ownerId);
  const now = Date.now();
  const expired: ExecutionJob[] = [];

  for (const job of activeJobs) {
    const startedAtMs = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
    const createdAtMs = Date.parse(job.createdAt);
    const baselineMs = Number.isFinite(startedAtMs) ? startedAtMs : createdAtMs;
    if (!Number.isFinite(baselineMs)) {
      continue;
    }

    if (now - baselineMs < staleAfterMs) {
      continue;
    }

    const message =
      "Execution timed out before completion. Marked failed so you can rerun with tighter scope or instruction.";
    const next = await updateExecutionJobAndPersist(ownerId, job.id, (draft) => {
      draft.status = "failed";
      draft.completedAt = new Date().toISOString();
      draft.error = message;
    });
    if (!next) {
      continue;
    }

    await persistExecutionJobEvent({
      job: next,
      event: "error",
      phase: "execute.timeout",
      status: "failed",
      message,
      payload: {
        error: message,
      },
    });
    expired.push(next);
  }

  return expired;
};

interface ExecuteJobRunnerInput {
  ownerId: string;
  jobId: string;
}

const runExecuteJobInBackground = async (
  input: ExecuteJobRunnerInput,
): Promise<void> => {
  const job = getExecutionJobById(input.ownerId, input.jobId);
  if (!job || job.status !== "queued") {
    return;
  }

  const project = getProjectByIdForOwner(job.projectId, input.ownerId);
  if (!project) {
    await persistExecutionJobEvent({
      job,
      event: "error",
      phase: "execute.error",
      status: "failed",
      message: "Project not found for execution job.",
      payload: { error: "Project not found." },
    });
    await updateExecutionJobAndPersist(input.ownerId, input.jobId, (next) => {
      next.status = "failed";
      next.completedAt = new Date().toISOString();
      next.error = "Project not found for execution job.";
    });
    return;
  }

  const pack = getScenarioPackById(input.ownerId, job.scenarioPackId);
  if (!pack || pack.projectId !== project.id) {
    await persistExecutionJobEvent({
      job,
      event: "error",
      phase: "execute.error",
      status: "failed",
      message: "Scenario pack not found for execution job.",
      payload: { error: "Scenario pack not found." },
    });
    await updateExecutionJobAndPersist(input.ownerId, input.jobId, (next) => {
      next.status = "failed";
      next.completedAt = new Date().toISOString();
      next.error = "Scenario pack not found for execution job.";
    });
    return;
  }

  const requestedScenarioIds = readStringArray(
    isRecord(job.constraints) ? (job.constraints as Record<string, unknown>).scenarioIds : undefined,
  );
  const scenarioIdFilter =
    requestedScenarioIds.length > 0 ? new Set(requestedScenarioIds) : null;
  const selectedScenarios = scenarioIdFilter
    ? pack.scenarios.filter((scenario) => scenarioIdFilter.has(scenario.id))
    : pack.scenarios;
  if (selectedScenarios.length === 0) {
    await persistExecutionJobEvent({
      job,
      event: "error",
      phase: "execute.error",
      status: "failed",
      message: "No valid scenarios selected for execution.",
      payload: { error: "No valid scenarios selected for execution." },
    });
    await updateExecutionJobAndPersist(input.ownerId, input.jobId, (next) => {
      next.status = "failed";
      next.completedAt = new Date().toISOString();
      next.error = "No valid scenarios selected for execution.";
    });
    return;
  }
  const executionPack =
    selectedScenarios.length === pack.scenarios.length
      ? pack
      : {
          ...pack,
          scenarios: selectedScenarios,
        };

  const runningJob = await updateExecutionJobAndPersist(
    input.ownerId,
    input.jobId,
    (next) => {
      next.status = "running";
      next.startedAt = next.startedAt ?? new Date().toISOString();
      next.completedAt = null;
      next.error = null;
    },
  );

  if (!runningJob) {
    return;
  }

  await persistExecutionJobEvent({
    job: runningJob,
    event: "status",
    phase: "execute.running",
    status: "running",
    message: "Execution job is running.",
  });

  for (const [index, scenario] of executionPack.scenarios.entries()) {
    await persistExecutionJobEvent({
      job: runningJob,
      event: "status",
      phase: "run.queue",
      status: "queued",
      scenarioId: scenario.id,
      stage: "run",
      message: `Queued ${index + 1}/${executionPack.scenarios.length}: waiting for prior scenarios to finish.`,
      payload: {
        action: "execute",
        phase: "run.queue",
        scenarioId: scenario.id,
        stage: "run",
        status: "queued",
        message: `Queued ${index + 1}/${executionPack.scenarios.length}: waiting for prior scenarios to finish.`,
      },
    });
  }

  const scenarioIds = executionPack.scenarios.map((scenario) => scenario.id);
  let activeScenarioId = scenarioIds[0] ?? null;
  let codexProgressCount = 0;
  let codexStoredCount = 0;
  let lastProgressScenarioId: string | null = null;
  if (activeScenarioId) {
    await persistExecutionJobEvent({
      job: runningJob,
      event: "status",
      phase: "run.progress",
      status: "running",
      scenarioId: activeScenarioId,
      stage: "run",
      message: "Starting scenario execution and collecting evidence...",
      payload: {
        action: "execute",
        phase: "run.progress",
        scenarioId: activeScenarioId,
        stage: "run",
        status: "running",
        message: "Starting scenario execution and collecting evidence...",
      },
    });
    lastProgressScenarioId = activeScenarioId;
  }

  let codexEventWrite = Promise.resolve();
  const enqueueCodexEvent = (eventName: string, payload: unknown) => {
    codexEventWrite = codexEventWrite
      .then(async () => {
        const mentionedScenarioId = findMentionedScenarioId(payload, scenarioIds);
        if (mentionedScenarioId) {
          activeScenarioId = mentionedScenarioId;
        }
        codexProgressCount += 1;
        const normalizedEventName = eventName.toLowerCase();
        const isTerminalSignal =
          normalizedEventName.includes("task_complete") ||
          normalizedEventName.includes("completed") ||
          normalizedEventName.includes("failed") ||
          normalizedEventName.includes("error");

        const shouldPersistCodexTrace =
          codexStoredCount < EXECUTION_JOB_MAX_CODEX_EVENTS &&
          (codexStoredCount < 25 || codexProgressCount % 25 === 0 || isTerminalSignal);

        if (shouldPersistCodexTrace) {
          codexStoredCount += 1;
          await persistExecutionJobEvent({
            job: runningJob,
            event: "codex",
            phase: extractExecutionJobEventPhase(eventName, payload),
            status: extractExecutionJobEventStatus(payload),
            message: extractExecutionJobEventMessage(eventName, payload),
            scenarioId: extractExecutionJobEventScenarioId(payload),
            stage: extractExecutionJobEventStage(payload),
            payload: {
              action: "execute",
              event: eventName,
              payload,
            },
            timestamp: new Date().toISOString(),
          });
        }

        const shouldEmitProgress =
          activeScenarioId &&
          (codexProgressCount === 1 ||
            codexProgressCount % 25 === 0 ||
            isTerminalSignal ||
            activeScenarioId !== lastProgressScenarioId);

        if (activeScenarioId && shouldEmitProgress) {
          const progressMessage = describeCodexExecuteProgress(eventName);
          await persistExecutionJobEvent({
            job: runningJob,
            event: "status",
            phase: "run.progress",
            status: "running",
            scenarioId: activeScenarioId,
            stage: "run",
            message: progressMessage,
            payload: {
              action: "execute",
              phase: "run.progress",
              scenarioId: activeScenarioId,
              stage: "run",
              status: "running",
              message: progressMessage,
            },
          });
          lastProgressScenarioId = activeScenarioId;
        }
      })
      .catch(() => {
        // Keep execution running even if a single event cannot be persisted.
      });
  };

  let persistedRun: ReturnType<typeof createScenarioRun> | null = null;
  try {
    const codexExecution = await executeScenariosViaCodexStream(
      {
        project,
        pack: executionPack,
        executionMode: runningJob.executionMode,
        userInstruction: runningJob.userInstruction ?? "",
        constraints: runningJob.constraints,
      },
      (event) => {
        enqueueCodexEvent(event.event, event.payload);
      },
    );

    await codexEventWrite;
    const liveJobAfterCodex = getExecutionJobById(input.ownerId, input.jobId);
    if (!liveJobAfterCodex || liveJobAfterCodex.status !== "running") {
      // Job was canceled/cleared while Codex was executing; stop without repopulating history.
      return;
    }

    const runInput = buildScenarioRunInputFromCodexOutput(
      input.ownerId,
      project.id,
      executionPack,
      codexExecution.parsedOutput,
    );
    const run = createScenarioRun(runInput);
    persistedRun = run;
    await persistScenarioRunToD1(run);

    project.activeScenarioPackId = executionPack.id;
    project.activeScenarioRunId = run.id;
    project.updatedAt = new Date().toISOString();
    upsertProjectRecord(project);
    await persistProjectToD1(project);

    for (const item of run.items) {
      await persistExecutionJobEvent({
        job: runningJob,
        event: "status",
        phase: "run.result",
        status: item.status,
        scenarioId: item.scenarioId,
        stage: "run",
        message: summarizeScenarioRunOutcome(item.status, item.observed),
        timestamp: item.completedAt ?? new Date().toISOString(),
        payload: {
          action: "execute",
          phase: "run.result",
          scenarioId: item.scenarioId,
          stage: "run",
          status: item.status,
          message: summarizeScenarioRunOutcome(item.status, item.observed),
        },
      });
    }

    await persistExecutionJobEvent({
      job: runningJob,
      event: "persisted",
      phase: "persisted.run",
      status: "running",
      message: "Scenario run persisted.",
      payload: {
        action: "execute",
        kind: "run",
        runId: run.id,
        summary: run.summary,
      },
    });

    let fixAttempt: ReturnType<typeof createFixAttempt> | null = null;
    if (
      runningJob.executionMode === "fix" ||
      runningJob.executionMode === "pr" ||
      runningJob.executionMode === "full"
    ) {
      const fixInput = buildFixAttemptInputFromCodexOutput(
        input.ownerId,
        project.id,
        run,
        codexExecution.parsedOutput,
      );
      if (!fixInput && run.summary.failed > 0) {
        throw new Error(
          "Codex execute output reported failed scenarios but omitted fixAttempt details.",
        );
      }
      if (fixInput) {
        fixAttempt = createFixAttempt(fixInput);
        await persistFixAttemptToD1(fixAttempt);

        for (const scenarioId of fixAttempt.failedScenarioIds) {
          await persistExecutionJobEvent({
            job: runningJob,
            event: "status",
            phase: "fix.progress",
            status: "running",
            scenarioId,
            stage: "fix",
            message: fixAttempt.patchSummary,
            payload: {
              action: "execute",
              phase: "fix.progress",
              scenarioId,
              stage: "fix",
              status: "running",
              message: fixAttempt.patchSummary,
            },
          });
        }

        if (fixAttempt.rerunSummary) {
          const rerunStatus = fixAttempt.rerunSummary.failed > 0 ? "failed" : "passed";
          for (const scenarioId of fixAttempt.failedScenarioIds) {
            await persistExecutionJobEvent({
              job: runningJob,
              event: "status",
              phase: "rerun.result",
              status: rerunStatus,
              scenarioId,
              stage: "rerun",
              message: `Rerun summary: ${fixAttempt.rerunSummary.passed} passed, ${fixAttempt.rerunSummary.failed} failed, ${fixAttempt.rerunSummary.blocked} blocked.`,
              payload: {
                action: "execute",
                phase: "rerun.result",
                scenarioId,
                stage: "rerun",
                status: rerunStatus,
                message: `Rerun summary: ${fixAttempt.rerunSummary.passed} passed, ${fixAttempt.rerunSummary.failed} failed, ${fixAttempt.rerunSummary.blocked} blocked.`,
              },
            });
          }
        }

        await persistExecutionJobEvent({
          job: runningJob,
          event: "persisted",
          phase: "persisted.fixAttempt",
          status: "running",
          message: "Fix attempt persisted.",
          payload: {
            action: "execute",
            kind: "fixAttempt",
            fixAttemptId: fixAttempt.id,
          },
        });
      }
    }

    let pullRequests: ReturnType<typeof listPullRequestsForProject> = [];
    if (
      (runningJob.executionMode === "pr" || runningJob.executionMode === "full") &&
      fixAttempt
    ) {
      const pullRequestInputs = buildPullRequestInputsFromCodexOutput(
        input.ownerId,
        project.id,
        fixAttempt,
        codexExecution.parsedOutput,
      );
      pullRequests = pullRequestInputs.map((entry) => createPullRequestRecord(entry));
      if (run.summary.failed > 0 && pullRequests.length === 0) {
        throw new Error(
          "Failed scenarios remain, but no real pull request URLs were produced by Codex execute.",
        );
      }
      await Promise.all(pullRequests.map((record) => persistPullRequestToD1(record)));

      for (const pr of pullRequests) {
        for (const scenarioId of pr.scenarioIds) {
          await persistExecutionJobEvent({
            job: runningJob,
            event: "status",
            phase: "pr.result",
            status: pr.url ? "passed" : "failed",
            scenarioId,
            stage: "pr",
            message: pr.url ? `PR ready: ${pr.title}` : `PR handoff required: ${pr.title}`,
            payload: {
              action: "execute",
              phase: "pr.result",
              scenarioId,
              stage: "pr",
              status: pr.url ? "passed" : "failed",
              message: pr.url ? `PR ready: ${pr.title}` : `PR handoff required: ${pr.title}`,
            },
          });
        }
      }

      await persistExecutionJobEvent({
        job: runningJob,
        event: "persisted",
        phase: "persisted.pullRequests",
        status: "running",
        message: `${pullRequests.length} pull request records persisted.`,
        payload: {
          action: "execute",
          kind: "pullRequests",
          count: pullRequests.length,
        },
      });
    }

    const completionStatus = inferExecutionJobStatusFromRun(run);
    const completedAt = new Date().toISOString();
    const finalJob = await updateExecutionJobAndPersist(
      input.ownerId,
      input.jobId,
      (next) => {
        next.status = completionStatus;
        next.completedAt = completedAt;
        next.runId = run.id;
        next.fixAttemptId = fixAttempt?.id ?? null;
        next.pullRequestIds = pullRequests.map((record) => record.id);
        next.summary = run.summary;
        next.executionAudit = {
          model: codexExecution.model,
          threadId: codexExecution.threadId,
          turnId: codexExecution.turnId,
          turnStatus: codexExecution.turnStatus,
          completedAt: codexExecution.completedAt,
        };
        next.error = null;
      },
    );

    const jobForCompletion = finalJob ?? runningJob;
    await persistExecutionJobEvent({
      job: jobForCompletion,
      event: "completed",
      phase: "execute.complete",
      status: "complete",
      message: "Execution job completed.",
      payload: {
        runId: run.id,
        fixAttemptId: fixAttempt?.id ?? null,
        pullRequestIds: pullRequests.map((record) => record.id),
        summary: run.summary,
        executionAudit: {
          model: codexExecution.model,
          threadId: codexExecution.threadId,
          turnId: codexExecution.turnId,
          turnStatus: codexExecution.turnStatus,
          completedAt: codexExecution.completedAt,
        },
      },
    });
  } catch (error) {
    await codexEventWrite.catch(() => undefined);

    const message =
      error instanceof Error ? error.message : "Failed to execute scenarios through Codex app-server.";
    await persistExecutionJobEvent({
      job: runningJob,
      event: "error",
      phase: "execute.error",
      status: "failed",
      message,
      payload: { error: message },
    });

    await updateExecutionJobAndPersist(input.ownerId, input.jobId, (next) => {
      next.status = "failed";
      next.completedAt = new Date().toISOString();
      next.runId = persistedRun?.id ?? null;
      next.fixAttemptId = null;
      next.pullRequestIds = [];
      next.summary = persistedRun?.summary ?? null;
      next.error = message;
    });
  }
};

const getPrincipalFromContext = (ctx: AppContext): AuthPrincipal | null =>
  ctx.auth?.principal ?? null;

const getProjectId = (params: Record<string, unknown> | undefined): string =>
  String(params?.projectId ?? "").trim();

const getLatestScenarioPackForProject = (
  ownerId: string,
  projectId: string,
): ScenarioPack | null => {
  const packs = listScenarioPacksForProject(ownerId, projectId);
  if (packs.length === 0) {
    return null;
  }

  return [...packs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
};

const githubConnectionView = (connection: GitHubConnection | null) => {
  if (!connection) {
    return null;
  }

  const tokenHealth = readGitHubTokenHealth(connection);

  return {
    id: connection.id,
    principalId: connection.principalId,
    provider: connection.provider,
    status: connection.status,
    accountLogin: connection.accountLogin,
    installationId: connection.installationId,
    accessTokenExpiresAt: connection.accessTokenExpiresAt,
    tokenHealth: tokenHealth.state,
    tokenHealthMessage: tokenHealth.message,
    repositories: connection.repositories,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
};

const GITHUB_TOKEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;

const readGitHubTokenHealth = (
  connection: GitHubConnection,
): { state: "fresh" | "stale" | "expired"; message: string | null } => {
  const token = connection.accessToken.trim();
  if (!token) {
    return {
      state: "expired",
      message: "GitHub token missing. Reconnect the installation.",
    };
  }

  const expiresAt = connection.accessTokenExpiresAt;
  if (!expiresAt) {
    return {
      state: "stale",
      message: "GitHub token expiry is unknown. Background refresh is recommended.",
    };
  }

  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) {
    return {
      state: "stale",
      message: "GitHub token expiry could not be parsed. Background refresh is recommended.",
    };
  }

  if (parsed <= Date.now()) {
    return {
      state: "expired",
      message: "GitHub token expired. Reconnect or re-sync the installation.",
    };
  }

  if (parsed <= Date.now() + GITHUB_TOKEN_REFRESH_WINDOW_MS) {
    return {
      state: "stale",
      message: "GitHub token is close to expiry. ScenarioForge is refreshing in the background.",
    };
  }

  return {
    state: "fresh",
    message: null,
  };
};

const parseGitHubOwnerFromRepoUrl = (repoUrl: string | null): string | null => {
  if (!repoUrl) {
    return null;
  }

  try {
    const url = new URL(repoUrl);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      return null;
    }

    const owner = url.pathname.split("/").filter(Boolean)[0] ?? "";
    const normalizedOwner = owner.trim().toLowerCase();
    return normalizedOwner || null;
  } catch {
    return null;
  }
};

const parseGitHubRepoFullNameFromUrl = (repoUrl: string | null): string | null => {
  if (!repoUrl) {
    return null;
  }

  try {
    const url = new URL(repoUrl);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      return null;
    }

    const segments = url.pathname
      .replace(/^\/+/g, "")
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    return `${segments[0]}/${segments[1]}`;
  } catch {
    return null;
  }
};

const collectGitHubOwnerHintsForPrincipal = (principalId: string): string[] => {
  const owners = listProjectsForOwner(principalId)
    .map((project) => parseGitHubOwnerFromRepoUrl(project.repoUrl))
    .filter((owner): owner is string => Boolean(owner));

  return [...new Set(owners)];
};

const isGitHubTokenStale = (connection: GitHubConnection): boolean => {
  return readGitHubTokenHealth(connection).state !== "fresh";
};

const refreshGitHubConnectionForPrincipal = async (
  principalId: string,
  installationId: number,
): Promise<GitHubConnection> => {
  const connectionResult = await connectGitHubInstallation(installationId);
  const connection = upsertGitHubConnection({
    principalId,
    accountLogin: connectionResult.accountLogin,
    installationId,
    accessToken: connectionResult.accessToken,
    accessTokenExpiresAt: connectionResult.accessTokenExpiresAt,
    repositories: connectionResult.repositories,
  });
  await persistGitHubConnectionToD1(connection);
  return connection;
};

const recoverGitHubConnectionForPrincipal = async (
  principalId: string,
): Promise<GitHubConnection | null> => {
  const ownerHints = collectGitHubOwnerHintsForPrincipal(principalId);
  if (ownerHints.length === 0) {
    return null;
  }

  const installationId = await findRecoverableGitHubInstallationId(ownerHints);
  if (!installationId) {
    return null;
  }

  return refreshGitHubConnectionForPrincipal(principalId, installationId);
};

const ensureGitHubConnectionForPrincipal = async (
  principalId: string,
): Promise<GitHubConnection | null> => {
  const latest = getLatestGitHubConnectionForPrincipal(principalId);
  if (latest?.status === "disconnected") {
    return null;
  }

  const existing = getGitHubConnectionForPrincipal(principalId);

  if (existing) {
    if (!isGitHubTokenStale(existing)) {
      return existing;
    }

    try {
      return await refreshGitHubConnectionForPrincipal(
        principalId,
        existing.installationId,
      );
    } catch {
      const expiresAt = existing.accessTokenExpiresAt
        ? Date.parse(existing.accessTokenExpiresAt)
        : Number.NaN;
      if (!Number.isNaN(expiresAt) && expiresAt > Date.now()) {
        return existing;
      }

      return null;
    }
  }

  try {
    return await recoverGitHubConnectionForPrincipal(principalId);
  } catch {
    return null;
  }
};

const refreshProjectPrReadiness = async (
  principalId: string,
  project: Project,
) => {
  const connection = await ensureGitHubConnectionForPrincipal(principalId);
  const readinessInput = await evaluateProjectPrReadiness({
    ownerId: principalId,
    project,
    githubConnection: connection,
  });
  const readiness = upsertProjectPrReadinessCheck(readinessInput);
  await persistProjectPrReadinessToD1(readiness);
  return readiness;
};

const ensureCodexBridgeAccount = async (): Promise<string | null> => {
  try {
    const account = await readChatGptAccount(false);
    if (account) {
      return null;
    }
    return "ChatGPT bridge auth is signed out. Use 'Sign In With ChatGPT' before running generate/execute.";
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Unable to verify ChatGPT bridge auth.";
  }
};

const withAuthContext: RouteMiddleware<AppRequestInfo> = async ({
  request,
  response,
  ctx,
}) => {
  const session = await loadAuthSession(request);

  if (!session) {
    ctx.auth = {
      session: null,
      principal: null,
    };
    return;
  }

  let principal = getPrincipalById(session.principalId);
  if (!principal) {
    try {
      await hydrateCoreStateFromD1({ force: true });
      principal = getPrincipalById(session.principalId);
    } catch {
      principal = null;
    }
  }

  if (!principal) {
    await clearAuthSession(request, response.headers);
    ctx.auth = {
      session: null,
      principal: null,
    };
    return;
  }

  let resolvedPrincipal = principal;
  if (principal.email) {
    try {
      const reconciled = await reconcilePrincipalIdentityInD1({
        provider: principal.provider,
        email: principal.email,
        displayName: principal.displayName,
      });

      if (reconciled) {
        resolvedPrincipal = reconciled;
      }
    } catch {
      resolvedPrincipal = principal;
    }
  }

  let resolvedSession = session;
  if (resolvedPrincipal.id !== session.principalId) {
    resolvedSession = {
      ...session,
      principalId: resolvedPrincipal.id,
      updatedAt: new Date().toISOString(),
    };
    await saveAuthSession(response.headers, resolvedSession);
  }

  ctx.auth = {
    session: resolvedSession,
    principal: resolvedPrincipal,
  };
};

const requireAuth: RouteMiddleware<AppRequestInfo> = ({ ctx }) => {
  if (!getPrincipalFromContext(ctx)) {
    return json({ error: "Authentication required." }, 401);
  }
};

export default defineApp([
  setCommonHeaders(),
  withAuthContext,
  route("/api/health", () =>
    json({
      ok: true,
      service: "scenarioforge-api",
      phase: "phase-6",
      timestamp: new Date().toISOString(),
    }),
  ),
  route("/api/auth/session", {
    get: ({ ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      return json({
        authenticated: Boolean(principal),
        principal,
      });
    },
  }),
  route("/api/auth/chatgpt/sign-in", {
    post: async () => {
      try {
        const login = await startChatGptLogin();
        return json(login, 201);
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to start ChatGPT sign-in flow.",
          },
          503,
        );
      }
    },
  }),
  route("/api/auth/chatgpt/sign-in/complete", {
    post: async ({ request, response }) => {
      try {
        const payload = await parseJsonBody(request);
        const loginId = String(payload?.loginId ?? "").trim();

        if (loginId) {
          const completion = await readChatGptLoginCompletion(loginId);

          if (completion && !completion.success) {
            return json(
              {
                error: completion.error ?? "ChatGPT sign-in did not complete successfully.",
              },
              409,
            );
          }
        }

        const account = await readChatGptAccount(true);

        if (!account) {
          await hydrateCoreStateFromD1({ force: true });
          const fallbackPrincipal = listPrincipals()
            .filter((entry) => entry.provider === "chatgpt")
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;

          if (fallbackPrincipal) {
            await saveAuthSession(
              response.headers,
              createAuthSession(fallbackPrincipal.id),
            );
            return json({
              authenticated: true,
              principal: fallbackPrincipal,
              restoredFromLocalState: true,
            });
          }

          return json(
            {
              authenticated: false,
              principal: null,
              pending: true,
            },
            202,
          );
        }

        const email = account.email;
        const displayName = email ?? "ChatGPT User";

        await hydrateCoreStateFromD1({ force: true });

        const principal =
          (email
            ? await reconcilePrincipalIdentityInD1({
                provider: "chatgpt",
                email,
                displayName,
              })
            : null) ??
          createPrincipal({
            provider: "chatgpt",
            displayName,
            email,
          });

        await persistPrincipalToD1(principal);
        await saveAuthSession(response.headers, createAuthSession(principal.id));

        return json({
          authenticated: true,
          principal,
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to complete ChatGPT sign-in.",
          },
          503,
        );
      }
    },
  }),
  route("/api/auth/chatgpt/sign-in/status", {
    get: async ({ request }) => {
      const url = new URL(request.url);
      const loginId = String(url.searchParams.get("loginId") ?? "").trim();

      if (!loginId) {
        return json({ error: "loginId is required." }, 400);
      }

      try {
        const completed = await readChatGptLoginCompletion(loginId);
        return json({
          completed,
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : "Failed to read login status.",
          },
          503,
        );
      }
    },
  }),
  route("/api/auth/chatgpt/sign-in/cancel", {
    post: async ({ request }) => {
      const payload = await parseJsonBody(request);
      const loginId = String(payload?.loginId ?? "").trim();

      if (!loginId) {
        return json({ error: "loginId is required." }, 400);
      }

      try {
        await cancelChatGptLogin(loginId);
        return json({ ok: true });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : "Failed to cancel ChatGPT login.",
          },
          503,
        );
      }
    },
  }),
  route("/api/auth/sign-out", {
    post: async ({ request, response }) => {
      const payload = await parseJsonBody(request);
      const remoteLogout = Boolean(payload?.remoteLogout);

      if (remoteLogout) {
        try {
          await logoutChatGpt();
        } catch {
          // Keep local sign-out reliable even if remote logout cannot be reached.
        }
      }

      await clearAuthSession(request, response.headers);
      return json({ ok: true });
    },
  }),
  route("/api/projects", [
    requireAuth,
    async ({ request, ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      if (request.method === "GET") {
        return json({ data: listProjectsForOwner(principal.id) });
      }

      if (request.method === "POST") {
        const payload = await parseJsonBody(request);
        const rawName = String(payload?.name ?? "").trim();

        if (!rawName) {
          return json({ error: "name is required" }, 400);
        }

        const repoUrl = String(payload?.repoUrl ?? "").trim() || null;
        const defaultBranch =
          String(payload?.defaultBranch ?? "main").trim() || "main";

        const project = createProject({
          ownerId: principal.id,
          name: rawName,
          repoUrl,
          defaultBranch,
        });
        await persistProjectToD1(project);

        return json({ project }, 201);
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/projects/:projectId", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const payload = await parseJsonBody(request);
      const name = payload?.name != null ? String(payload.name).trim() : undefined;
      const repoUrl = payload?.repoUrl != null ? String(payload.repoUrl).trim() || null : undefined;
      const defaultBranch = payload?.defaultBranch != null ? String(payload.defaultBranch).trim() : undefined;

      if (name !== undefined && name.length === 0) {
        return json({ error: "name cannot be empty." }, 400);
      }
      if (defaultBranch !== undefined && defaultBranch.length === 0) {
        return json({ error: "defaultBranch cannot be empty." }, 400);
      }

      const repoChanged = repoUrl !== undefined && repoUrl !== project.repoUrl;
      const branchChanged =
        defaultBranch !== undefined && defaultBranch !== project.defaultBranch;

      if (name !== undefined) project.name = name;
      if (repoUrl !== undefined) project.repoUrl = repoUrl;
      if (defaultBranch !== undefined) project.defaultBranch = defaultBranch;
      if (repoChanged || branchChanged) {
        project.activeManifestId = null;
        project.activeScenarioPackId = null;
        project.activeScenarioRunId = null;
      }
      project.updatedAt = new Date().toISOString();

      upsertProjectRecord(project);
      await persistProjectToD1(project);

      return json({ project });
    },
  ]),
  route("/api/projects/:projectId/pr-readiness", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({
          readiness: getLatestProjectPrReadinessForProject(principal.id, project.id),
        });
      }

      if (request.method === "POST") {
        const readiness = await refreshProjectPrReadiness(principal.id, project);
        return json({ readiness });
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/github/connect/start", [
    requireAuth,
    async ({ request, ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const url = new URL(request.url);
      const forceReconnect = url.searchParams.get("force") === "1";
      const existing = forceReconnect
        ? getGitHubConnectionForPrincipal(principal.id)
        : await ensureGitHubConnectionForPrincipal(principal.id);

      if (existing && !forceReconnect) {
        return json({
          alreadyConnected: true,
          connection: githubConnectionView(existing),
          manageUrl: `https://github.com/settings/installations/${existing.installationId}`,
        });
      }

      try {
        const state = issueGitHubConnectState(principal.id);
        const installUrl = getGitHubInstallUrl(state);

        return json({
          state,
          installUrl,
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to build GitHub installation URL.",
          },
          400,
        );
      }
    },
  ]),
  route("/api/github/connect", [
    requireAuth,
    async ({ request, ctx }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const payload = await parseJsonBody(request);
      const installationId = Number(payload?.installationId);

      if (!Number.isInteger(installationId) || installationId <= 0) {
        return json({ error: "installationId must be a positive integer." }, 400);
      }

      try {
        const connectionResult = await connectGitHubInstallation(installationId);

        const connection = upsertGitHubConnection({
          principalId: principal.id,
          accountLogin: connectionResult.accountLogin,
          installationId,
          accessToken: connectionResult.accessToken,
          accessTokenExpiresAt: connectionResult.accessTokenExpiresAt,
          repositories: connectionResult.repositories,
        });
        await persistGitHubConnectionToD1(connection);

        return json({
          connection: githubConnectionView(connection),
          repositories: connection.repositories,
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to connect GitHub installation.",
          },
          400,
        );
      }
    },
  ]),
  route("/api/github/connect/sync", [
    requireAuth,
    async ({ request, ctx }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const existing = await ensureGitHubConnectionForPrincipal(principal.id);
      if (!existing) {
        return json({ error: "No GitHub installation connected yet." }, 400);
      }

      const payload = await parseJsonBody(request);
      const requestedInstallationId = Number(payload?.installationId);
      const installationId =
        Number.isInteger(requestedInstallationId) && requestedInstallationId > 0
          ? requestedInstallationId
          : existing.installationId;

      try {
        const connectionResult = await connectGitHubInstallation(installationId);

        const connection = upsertGitHubConnection({
          principalId: principal.id,
          accountLogin: connectionResult.accountLogin,
          installationId,
          accessToken: connectionResult.accessToken,
          accessTokenExpiresAt: connectionResult.accessTokenExpiresAt,
          repositories: connectionResult.repositories,
        });
        await persistGitHubConnectionToD1(connection);

        return json({
          connection: githubConnectionView(connection),
          repositories: connection.repositories,
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to sync GitHub installation repositories.",
          },
          400,
        );
      }
    },
  ]),
  route("/api/github/connect/callback", [
    async ({ request, ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return githubCallbackRedirect(request, "error", "auth_required");
      }

      const url = new URL(request.url);
      const installationId = Number(url.searchParams.get("installation_id"));
      const state = url.searchParams.get("state") ?? "";

      if (!Number.isInteger(installationId) || installationId <= 0) {
        return githubCallbackRedirect(
          request,
          "error",
          "installation_id_invalid",
        );
      }

      if (state && !consumeGitHubConnectState(state, principal.id)) {
        return githubCallbackRedirect(request, "error", "state_invalid_or_expired");
      }

      try {
        const connectionResult = await connectGitHubInstallation(installationId);

        const connection = upsertGitHubConnection({
          principalId: principal.id,
          accountLogin: connectionResult.accountLogin,
          installationId,
          accessToken: connectionResult.accessToken,
          accessTokenExpiresAt: connectionResult.accessTokenExpiresAt,
          repositories: connectionResult.repositories,
        });
        await persistGitHubConnectionToD1(connection);

        return githubCallbackRedirect(request, "connected");
      } catch {
        return githubCallbackRedirect(request, "error", "connect_failed");
      }
    },
  ]),
  route("/api/github/connection", [
    requireAuth,
    async ({ ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const connection = await ensureGitHubConnectionForPrincipal(principal.id);
      return json({ connection: githubConnectionView(connection) });
    },
  ]),
  route("/api/github/repos", [
    requireAuth,
    async ({ ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const connection = await ensureGitHubConnectionForPrincipal(principal.id);

      return json({
        data: connection?.repositories ?? [],
      });
    },
  ]),
  route("/api/github/disconnect", [
    requireAuth,
    async ({ request, ctx }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const connection = disconnectGitHubConnectionForPrincipal(principal.id);
      if (connection) {
        await persistGitHubConnectionToD1(connection);
      }
      return json({ ok: true });
    },
  ]),
  route("/api/projects/:projectId/sources/scan", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const githubConnection = await ensureGitHubConnectionForPrincipal(
        principal.id,
      );
      if (!githubConnection) {
        return json(
          { error: "Connect GitHub before scanning repository sources." },
          400,
        );
      }

      let scanned;
      try {
        scanned = await scanSourcesAndCodeBaselineForProject(
          project,
          principal.id,
          githubConnection.repositories,
          {
            githubToken: githubConnection.accessToken,
            strict: true,
          },
        );
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to scan repository sources.",
          },
          400,
        );
      }

      const data = upsertProjectSources({
        ownerId: principal.id,
        projectId: project.id,
        sources: scanned.sources,
      });
      const codeBaseline = upsertProjectCodeBaseline(scanned.codeBaseline);
      await Promise.all([
        ...data.map((source) => persistSourceRecordToD1(source)),
        persistCodeBaselineToD1(codeBaseline),
      ]);

      return json({ data, codeBaseline });
    },
  ]),
  route("/api/projects/:projectId/sources", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({ data: listSourcesForProject(principal.id, project.id) });
      }

      if (request.method === "POST") {
        const payload = await parseJsonBody(request);
        const sourceIds = readStringArray(payload?.sourceIds);
        const data = updateSourceSelections(principal.id, project.id, sourceIds);
        await Promise.all(data.map((source) => persistSourceRecordToD1(source)));
        return json({ data });
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/projects/:projectId/source-manifests", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({ data: listSourceManifestsForProject(principal.id, project.id) });
      }

      if (request.method === "POST") {
        const payload = await parseJsonBody(request);
        const sourceIds = readStringArray(payload?.sourceIds);
        const userConfirmed = Boolean(payload?.userConfirmed);
        const confirmationNote = String(payload?.confirmationNote ?? "");

        const allSources = listSourcesForProject(principal.id, project.id);
        const codeBaseline = getLatestCodeBaselineForProject(principal.id, project.id);
        if (!codeBaseline) {
          return json(
            { error: "Code baseline is required. Scan sources to build the baseline first." },
            400,
          );
        }
        const selectedSet = new Set(sourceIds);
        const selectedSources = allSources.filter((source) =>
          selectedSet.has(source.id),
        );
        const validation = validateGenerationSelection(selectedSources, userConfirmed);

        if (!validation.ok) {
          return json({ error: validation.error }, 400);
        }

        const updatedSources = updateSourceSelections(
          principal.id,
          project.id,
          sourceIds,
        );
        await Promise.all(updatedSources.map((source) => persistSourceRecordToD1(source)));
        const finalSelectedSources = updatedSources.filter((source) =>
          selectedSet.has(source.id),
        );
        const fallbackSource = finalSelectedSources[0] ?? updatedSources[0] ?? null;
        const repositoryFullName =
          codeBaseline?.repositoryFullName ??
          fallbackSource?.repositoryFullName ??
          parseGitHubRepoFullNameFromUrl(project.repoUrl) ??
          "unknown";
        const branch =
          codeBaseline?.branch ?? fallbackSource?.branch ?? project.defaultBranch ?? "main";
        const headCommitSha =
          codeBaseline?.headCommitSha ?? fallbackSource?.headCommitSha ?? "unknown";
        const manifestInput = buildSourceManifest({
          ownerId: principal.id,
          projectId: project.id,
          selectedSources: finalSelectedSources,
          repositoryFullName,
          branch,
          headCommitSha,
          userConfirmed,
          confirmationNote,
          codeBaselineId: codeBaseline?.id,
          codeBaselineHash: codeBaseline?.baselineHash,
          codeBaselineGeneratedAt: codeBaseline?.generatedAt,
        });

        const manifest = createSourceManifest(manifestInput);
        await persistSourceManifestToD1(manifest);
        project.activeManifestId = manifest.id;
        project.activeScenarioPackId = null;
        project.activeScenarioRunId = null;
        project.updatedAt = new Date().toISOString();
        upsertProjectRecord(project);
        await persistProjectToD1(project);

        return json({
          manifest,
          selectedSources: finalSelectedSources,
          includesStale: validation.includesStale,
          includesConflicts: validation.includesConflicts,
          codeBaseline,
        });
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/projects/:projectId/actions/generate/stream", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      await expireStaleExecutionJobs(principal.id);
      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const payload = await parseJsonBody(request);
      const requestedManifestId =
        String(payload?.sourceManifestId ?? payload?.manifestId ?? "").trim();
      const manifestId = requestedManifestId || project.activeManifestId || "";
      const manifest =
        (manifestId
          ? getSourceManifestById(principal.id, manifestId)
          : getLatestSourceManifestForProject(principal.id, project.id)) ?? null;

      if (!manifest || manifest.projectId !== project.id) {
        return json({ error: "Source manifest not found." }, 404);
      }

      const selectedSources = listSourcesForProject(principal.id, project.id).filter(
        (source) => manifest.sourceIds.includes(source.id),
      );
      if (manifest.sourceIds.length > 0 && selectedSources.length === 0) {
        return json({ error: "Manifest selected sources could not be resolved." }, 400);
      }
      const codeBaseline =
        getCodeBaselineById(principal.id, manifest.codeBaselineId) ??
        getLatestCodeBaselineForProject(principal.id, project.id);
      if (!codeBaseline) {
        return json(
          { error: "Code baseline is required for generation. Re-scan sources first." },
          400,
        );
      }

      const modeValue = String(payload?.mode ?? "initial")
        .trim()
        .toLowerCase();
      const mode = modeValue === "update" ? "update" : "initial";
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
      const defaultPack =
        (project.activeScenarioPackId
          ? getScenarioPackById(principal.id, project.activeScenarioPackId)
          : null) ?? getLatestScenarioPackForProject(principal.id, project.id);
      const existingPack =
        mode === "update"
          ? scenarioPackId
            ? getScenarioPackById(principal.id, scenarioPackId)
            : defaultPack
          : null;

      const githubConnection = await ensureGitHubConnectionForPrincipal(principal.id);
      if (!githubConnection) {
        return json({ error: "Connect GitHub before generating scenarios." }, 400);
      }
      const bridgeAuthError = await ensureCodexBridgeAccount();
      if (bridgeAuthError) {
        return json({ error: bridgeAuthError }, 401);
      }

      return createSseResponse(async (emit) => {
        emit("started", {
          action: "generate",
          mode,
          timestamp: new Date().toISOString(),
        });

        emit("status", {
          action: "generate",
          phase: "running",
          timestamp: new Date().toISOString(),
        });

        let scenarioPackInput: ReturnType<typeof generateScenarioPack> | null = null;
        try {
          const codexGeneration = await generateScenariosViaCodexStream(
            {
              project,
              manifest,
              selectedSources,
              codeBaseline,
              githubToken: githubConnection.accessToken,
              mode,
              userInstruction,
              existingPack,
              useSkill: true,
            },
            (event) => {
              emit("codex", {
                action: "generate",
                event: event.event,
                payload: event.payload,
                timestamp: new Date().toISOString(),
              });
            },
          );

          scenarioPackInput = generateScenarioPack({
            project,
            ownerId: principal.id,
            manifest,
            selectedSources,
            codeBaseline,
            model: codexGeneration.model,
            rawOutput: codexGeneration.responseText,
            metadata: {
              transport: "codex-app-server",
              requestedSkill: codexGeneration.skillRequested,
              usedSkill: codexGeneration.skillUsed,
              skillAvailable: codexGeneration.skillAvailable,
              skillPath: codexGeneration.skillPath,
              threadId: codexGeneration.threadId,
              turnId: codexGeneration.turnId,
              turnStatus: codexGeneration.turnStatus,
              cwd: codexGeneration.cwd,
              generatedAt: codexGeneration.completedAt,
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "generation failed";
          emit("error", {
            action: "generate",
            error: `Failed to generate scenarios through Codex app-server. ${message}`.trim(),
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const pack = createScenarioPack(scenarioPackInput);
        await persistScenarioPackToD1(pack);
        project.activeManifestId = manifest.id;
        project.activeScenarioPackId = pack.id;
        project.activeScenarioRunId = null;
        project.updatedAt = new Date().toISOString();
        upsertProjectRecord(project);
        await persistProjectToD1(project);
        emit("persisted", {
          action: "generate",
          packId: pack.id,
          scenarioCount: pack.scenarios.length,
          timestamp: new Date().toISOString(),
        });
        for (const [index, scenario] of pack.scenarios.entries()) {
          emit("status", {
            action: "generate",
            phase: "generate.scenario",
            scenarioId: scenario.id,
            status: "passed",
            message: `Created ${index + 1}/${pack.scenarios.length}: ${scenario.id} ${scenario.title}`,
            timestamp: new Date().toISOString(),
          });
        }
        emit("completed", {
          pack,
          mode,
          userInstruction: userInstruction || null,
          timestamp: new Date().toISOString(),
        });
      });
    },
  ]),
  route("/api/projects/:projectId/actions/execute/start", [
    requireAuth,
    async ({ request, ctx, params, cf }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      await expireStaleExecutionJobs(principal.id);
      const activeJobs = listActiveExecutionJobsForOwner(principal.id);
      if (activeJobs.length >= EXECUTION_JOB_MAX_ACTIVE_PER_OWNER) {
        return json(
          {
            error: `Active execution cap reached (${EXECUTION_JOB_MAX_ACTIVE_PER_OWNER}). Wait for a running job to finish before starting another.`,
          },
          429,
        );
      }

      const payload = await parseJsonBody(request);
      const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
      const defaultPack =
        (project.activeScenarioPackId
          ? getScenarioPackById(principal.id, project.activeScenarioPackId)
          : null) ?? getLatestScenarioPackForProject(principal.id, project.id);
      const pack =
        (scenarioPackId
          ? getScenarioPackById(principal.id, scenarioPackId)
          : defaultPack) ?? null;

      if (!pack || pack.projectId !== project.id) {
        return json({ error: "Scenario pack not found." }, 404);
      }

      const executionMode = normalizeExecutionMode(payload?.executionMode);
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const baseConstraints = isRecord(payload?.constraints) ? payload.constraints : {};
      const retryStrategyRaw = String(payload?.retryStrategy ?? "").trim().toLowerCase();
      const retryStrategy = retryStrategyRaw === "failed_only" ? "failed_only" : "full";
      const retryFromRunId = String(payload?.retryFromRunId ?? "").trim();
      const explicitScenarioIds = readStringArray(payload?.scenarioIds);
      let scenarioIds = explicitScenarioIds;

      if (retryStrategy === "failed_only") {
        const baselineRunId = retryFromRunId || project.activeScenarioRunId || "";
        const baselineRun = baselineRunId
          ? getScenarioRunById(principal.id, baselineRunId)
          : listScenarioRunsForProject(principal.id, project.id)[0] ?? null;
        if (!baselineRun || baselineRun.projectId !== project.id) {
          return json(
            {
              error:
                "Retry failed requires a prior scenario run in this project. Execute once before retrying failed scenarios.",
            },
            409,
          );
        }

        const failedScenarioIds = baselineRun.items
          .filter((item) => item.status === "failed")
          .map((item) => item.scenarioId);
        if (failedScenarioIds.length === 0) {
          return json(
            {
              error:
                "Retry failed was requested, but the selected run has no failed scenarios.",
            },
            409,
          );
        }

        if (explicitScenarioIds.length > 0) {
          const failedSet = new Set(failedScenarioIds);
          scenarioIds = explicitScenarioIds.filter((scenarioId) =>
            failedSet.has(scenarioId),
          );
          if (scenarioIds.length === 0) {
            return json(
              {
                error:
                  "Provided scenarioIds are not part of the failed subset for the selected run.",
              },
              400,
            );
          }
        } else {
          scenarioIds = failedScenarioIds;
        }
      }

      const constraints = {
        ...baseConstraints,
        retryStrategy,
        retryFromRunId: retryFromRunId || null,
        scenarioIds,
      };
      const bridgeAuthError = await ensureCodexBridgeAccount();
      if (bridgeAuthError) {
        return json({ error: bridgeAuthError }, 401);
      }

      const job = createExecutionJob({
        projectId: project.id,
        ownerId: principal.id,
        scenarioPackId: pack.id,
        executionMode,
        status: "queued",
        userInstruction: userInstruction || null,
        constraints,
        startedAt: null,
        completedAt: null,
        runId: null,
        fixAttemptId: null,
        pullRequestIds: [],
        summary: null,
        executionAudit: {
          model: null,
          threadId: null,
          turnId: null,
          turnStatus: null,
          completedAt: null,
        },
        error: null,
      });
      await persistExecutionJobToD1(job);

      await persistExecutionJobEvent({
        job,
        event: "started",
        phase: "execute.queued",
        status: "queued",
        message: "Execution job queued.",
        payload: {
          action: "execute",
          executionMode,
          scenarioPackId: pack.id,
          retryStrategy,
          scenarioCount: scenarioIds.length > 0 ? scenarioIds.length : pack.scenarios.length,
          timestamp: new Date().toISOString(),
        },
      });

      const runPromise = runExecuteJobInBackground({
        ownerId: principal.id,
        jobId: job.id,
      });
      cf.waitUntil(runPromise);

      return json(
        {
          job,
          activeCount: activeJobs.length + 1,
          activeLimit: EXECUTION_JOB_MAX_ACTIVE_PER_OWNER,
        },
        202,
      );
    },
  ]),
  route("/api/projects/:projectId/actions/execute/stream", [
    requireAuth,
    async () => {
      return json(
        {
          error:
            "Deprecated endpoint. Use /api/projects/:projectId/actions/execute/start and job events.",
        },
        410,
      );
    },
  ]),
  route("/api/projects/:projectId/actions/generate", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const payload = await parseJsonBody(request);
      const requestedManifestId =
        String(payload?.sourceManifestId ?? payload?.manifestId ?? "").trim();
      const manifestId = requestedManifestId || project.activeManifestId || "";
      const manifest =
        (manifestId
          ? getSourceManifestById(principal.id, manifestId)
          : getLatestSourceManifestForProject(principal.id, project.id)) ?? null;

      if (!manifest || manifest.projectId !== project.id) {
        return json({ error: "Source manifest not found." }, 404);
      }

      const selectedSources = listSourcesForProject(principal.id, project.id).filter(
        (source) => manifest.sourceIds.includes(source.id),
      );
      if (manifest.sourceIds.length > 0 && selectedSources.length === 0) {
        return json({ error: "Manifest selected sources could not be resolved." }, 400);
      }
      const codeBaseline =
        getCodeBaselineById(principal.id, manifest.codeBaselineId) ??
        getLatestCodeBaselineForProject(principal.id, project.id);
      if (!codeBaseline) {
        return json(
          { error: "Code baseline is required for generation. Re-scan sources first." },
          400,
        );
      }

      const modeValue = String(payload?.mode ?? "initial")
        .trim()
        .toLowerCase();
      const mode = modeValue === "update" ? "update" : "initial";
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
      const defaultPack =
        (project.activeScenarioPackId
          ? getScenarioPackById(principal.id, project.activeScenarioPackId)
          : null) ?? getLatestScenarioPackForProject(principal.id, project.id);
      const existingPack =
        mode === "update"
          ? scenarioPackId
            ? getScenarioPackById(principal.id, scenarioPackId)
            : defaultPack
          : null;

      const githubConnection = await ensureGitHubConnectionForPrincipal(principal.id);
      if (!githubConnection) {
        return json({ error: "Connect GitHub before generating scenarios." }, 400);
      }
      const bridgeAuthError = await ensureCodexBridgeAccount();
      if (bridgeAuthError) {
        return json({ error: bridgeAuthError }, 401);
      }

      let scenarioPackInput:
        | ReturnType<typeof generateScenarioPack>
        | null = null;
      try {
        const codexGeneration = await generateScenariosViaCodex({
          project,
          manifest,
          selectedSources,
          codeBaseline,
          githubToken: githubConnection.accessToken,
          mode,
          userInstruction,
          existingPack,
          useSkill: true,
        });

        scenarioPackInput = generateScenarioPack({
          project,
          ownerId: principal.id,
          manifest,
          selectedSources,
          codeBaseline,
          model: codexGeneration.model,
          rawOutput: codexGeneration.responseText,
          metadata: {
            transport: "codex-app-server",
            requestedSkill: codexGeneration.skillRequested,
            usedSkill: codexGeneration.skillUsed,
            skillAvailable: codexGeneration.skillAvailable,
            skillPath: codexGeneration.skillPath,
            threadId: codexGeneration.threadId,
            turnId: codexGeneration.turnId,
            turnStatus: codexGeneration.turnStatus,
            cwd: codexGeneration.cwd,
            generatedAt: codexGeneration.completedAt,
          },
        });
      } catch (error) {
        return json(
          {
            error: `Failed to generate scenarios through Codex app-server. ${
              error instanceof Error ? error.message : "generation failed"
            }`.trim(),
          },
          502,
        );
      }

      if (!scenarioPackInput) {
        return json(
          { error: "Failed to generate scenarios through Codex app-server." },
          502,
        );
      }

      const pack = createScenarioPack(scenarioPackInput);
      await persistScenarioPackToD1(pack);
      project.activeManifestId = manifest.id;
      project.activeScenarioPackId = pack.id;
      project.activeScenarioRunId = null;
      project.updatedAt = new Date().toISOString();
      upsertProjectRecord(project);
      await persistProjectToD1(project);
      return json(
        {
          pack,
          mode,
          userInstruction: userInstruction || null,
        },
        201,
      );
    },
  ]),
  route("/api/projects/:projectId/actions/execute", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const payload = await parseJsonBody(request);
      const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
      const defaultPack =
        (project.activeScenarioPackId
          ? getScenarioPackById(principal.id, project.activeScenarioPackId)
          : null) ?? getLatestScenarioPackForProject(principal.id, project.id);
      const pack =
        (scenarioPackId
          ? getScenarioPackById(principal.id, scenarioPackId)
          : defaultPack) ?? null;

      if (!pack || pack.projectId !== project.id) {
        return json({ error: "Scenario pack not found." }, 404);
      }

      const executionMode = normalizeExecutionMode(payload?.executionMode);
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const constraints = isRecord(payload?.constraints) ? payload.constraints : {};
      const bridgeAuthError = await ensureCodexBridgeAccount();
      if (bridgeAuthError) {
        return json({ error: bridgeAuthError }, 401);
      }

      let codexExecution;
      try {
        codexExecution = await executeScenariosViaCodex({
          project,
          pack,
          executionMode,
          userInstruction,
          constraints,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to execute scenarios through Codex app-server.";
        return json({ error: message }, 502);
      }

      const runInput = buildScenarioRunInputFromCodexOutput(
        principal.id,
        project.id,
        pack,
        codexExecution.parsedOutput,
      );
      const run = createScenarioRun(runInput);
      await persistScenarioRunToD1(run);
      project.activeScenarioPackId = pack.id;
      project.activeScenarioRunId = run.id;
      project.updatedAt = new Date().toISOString();
      upsertProjectRecord(project);
      await persistProjectToD1(project);

      let fixAttempt: ReturnType<typeof createFixAttempt> | null = null;
      if (executionMode === "fix" || executionMode === "pr" || executionMode === "full") {
        const fixInput = buildFixAttemptInputFromCodexOutput(
          principal.id,
          project.id,
          run,
          codexExecution.parsedOutput,
        );
        if (!fixInput && run.summary.failed > 0) {
          return json(
            {
              run,
              fixAttempt: null,
              pullRequests: [],
              executionMode,
              executionAudit: {
                model: codexExecution.model,
                threadId: codexExecution.threadId,
                turnId: codexExecution.turnId,
                turnStatus: codexExecution.turnStatus,
                completedAt: codexExecution.completedAt,
              },
              error:
                "Codex execute output reported failed scenarios but omitted fixAttempt details.",
            },
            502,
          );
        }
        if (fixInput) {
          fixAttempt = createFixAttempt(fixInput);
          await persistFixAttemptToD1(fixAttempt);
        }
      }

      let pullRequests: ReturnType<typeof listPullRequestsForProject> = [];
      if ((executionMode === "pr" || executionMode === "full") && fixAttempt) {
        const pullRequestInputs = buildPullRequestInputsFromCodexOutput(
          principal.id,
          project.id,
          fixAttempt,
          codexExecution.parsedOutput,
        );
        pullRequests = pullRequestInputs.map((input) => createPullRequestRecord(input));
        if (run.summary.failed > 0 && pullRequests.length === 0) {
          return json(
            {
              run,
              fixAttempt,
              pullRequests: [],
              executionMode,
              executionAudit: {
                model: codexExecution.model,
                threadId: codexExecution.threadId,
                turnId: codexExecution.turnId,
                turnStatus: codexExecution.turnStatus,
                completedAt: codexExecution.completedAt,
              },
              error:
                "Failed scenarios remain, but no real pull request URLs were produced by Codex execute.",
            },
            502,
          );
        }
        await Promise.all(pullRequests.map((record) => persistPullRequestToD1(record)));
      }

      return json(
        {
          run,
          fixAttempt,
          pullRequests,
          executionMode,
          executionAudit: {
            model: codexExecution.model,
            threadId: codexExecution.threadId,
            turnId: codexExecution.turnId,
            turnStatus: codexExecution.turnStatus,
            completedAt: codexExecution.completedAt,
          },
        },
        201,
      );
    },
  ]),
  route("/api/jobs/active", [
    requireAuth,
    async ({ request, ctx }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      try {
        await expireStaleExecutionJobs(principal.id);
      } catch {
        // Non-fatal: stale-job cleanup should not break active polling paths.
      }
      const projects = listProjectsForOwner(principal.id);
      const projectsById = new Map(projects.map((project) => [project.id, project]));

      const jobs = listActiveExecutionJobsForOwner(principal.id).map((job) => {
        const project = projectsById.get(job.projectId) ?? null;
        const artifacts = resolveExecutionJobArtifacts(principal.id, job);
        return {
          job,
          project: project
            ? {
                id: project.id,
                name: project.name,
                repoUrl: project.repoUrl,
                defaultBranch: project.defaultBranch,
              }
            : null,
          run: artifacts.run,
          fixAttempt: artifacts.fixAttempt,
          pullRequests: artifacts.pullRequests,
        };
      });

      return json({
        data: jobs,
        activeLimit: EXECUTION_JOB_MAX_ACTIVE_PER_OWNER,
      });
    },
  ]),
  route("/api/jobs/:jobId/events", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      try {
        await expireStaleExecutionJobs(principal.id);
      } catch {
        // Non-fatal: stale-job cleanup should not break event polling.
      }
      const jobId = String(params?.jobId ?? "").trim();
      const job = getExecutionJobById(principal.id, jobId);
      if (!job) {
        return json({ error: "Execution job not found." }, 404);
      }

      const url = new URL(request.url);
      const cursor = readNumber(url.searchParams.get("cursor"), 0);
      const limit = Math.min(
        Math.max(readNumber(url.searchParams.get("limit"), 100), 1),
        EXECUTION_JOB_EVENT_PAGE_LIMIT,
      );
      const rows = listExecutionJobEvents(principal.id, job.id, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = data[data.length - 1]?.sequence ?? cursor;

      return json({
        data,
        cursor,
        nextCursor,
        hasMore,
      });
    },
  ]),
  route("/api/jobs/:jobId", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      try {
        await expireStaleExecutionJobs(principal.id);
      } catch {
        // Non-fatal: stale-job cleanup should not break detail reads.
      }
      const jobId = String(params?.jobId ?? "").trim();
      const job = getExecutionJobById(principal.id, jobId);
      if (!job) {
        return json({ error: "Execution job not found." }, 404);
      }

      const artifacts = resolveExecutionJobArtifacts(principal.id, job);
      return json({
        job,
        run: artifacts.run,
        fixAttempt: artifacts.fixAttempt,
        pullRequests: artifacts.pullRequests,
      });
    },
  ]),
  route("/api/projects/:projectId/scenario-packs", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({ data: listScenarioPacksForProject(principal.id, project.id) });
      }

      if (request.method === "POST") {
        const payload = await parseJsonBody(request);
        const requestedManifestId = String(payload?.manifestId ?? "").trim();
        const manifestId = requestedManifestId || project.activeManifestId || "";
        const manifest =
          (manifestId
            ? getSourceManifestById(principal.id, manifestId)
            : getLatestSourceManifestForProject(principal.id, project.id)) ?? null;

        if (!manifest || manifest.projectId !== project.id) {
          return json({ error: "Source manifest not found." }, 404);
        }

        const sources = listSourcesForProject(principal.id, project.id).filter((source) =>
          manifest.sourceIds.includes(source.id),
        );

        if (manifest.sourceIds.length > 0 && sources.length === 0) {
          return json({ error: "Manifest selected sources could not be resolved." }, 400);
        }
        const codeBaseline =
          getCodeBaselineById(principal.id, manifest.codeBaselineId) ??
          getLatestCodeBaselineForProject(principal.id, project.id);
        if (!codeBaseline) {
          return json(
            { error: "Code baseline is required for generation. Re-scan sources first." },
            400,
          );
        }

        const githubConnection = await ensureGitHubConnectionForPrincipal(
          principal.id,
        );
        if (!githubConnection) {
          return json(
            { error: "Connect GitHub before generating scenarios." },
            400,
          );
        }

        let scenarioPackInput:
          | ReturnType<typeof generateScenarioPack>
          | null = null;
        try {
          const codexGeneration = await generateScenariosViaCodex({
            project,
            manifest,
            selectedSources: sources,
            codeBaseline,
            githubToken: githubConnection.accessToken,
            useSkill: true,
          });

          scenarioPackInput = generateScenarioPack({
            project,
            ownerId: principal.id,
            manifest,
            selectedSources: sources,
            codeBaseline,
            model: codexGeneration.model,
            rawOutput: codexGeneration.responseText,
            metadata: {
              transport: "codex-app-server",
              requestedSkill: codexGeneration.skillRequested,
              usedSkill: codexGeneration.skillUsed,
              skillAvailable: codexGeneration.skillAvailable,
              skillPath: codexGeneration.skillPath,
              threadId: codexGeneration.threadId,
              turnId: codexGeneration.turnId,
              turnStatus: codexGeneration.turnStatus,
              cwd: codexGeneration.cwd,
              generatedAt: codexGeneration.completedAt,
            },
          });
        } catch (error) {
          return json(
            {
              error: `Failed to generate scenarios through Codex app-server. ${
                error instanceof Error ? error.message : "generation failed"
              }`.trim(),
            },
            502,
          );
        }

        if (!scenarioPackInput) {
          return json(
            { error: "Failed to generate scenarios through Codex app-server." },
            502,
          );
        }

        const pack = createScenarioPack(scenarioPackInput);
        await persistScenarioPackToD1(pack);
        project.activeManifestId = manifest.id;
        project.activeScenarioPackId = pack.id;
        project.activeScenarioRunId = null;
        project.updatedAt = new Date().toISOString();
        upsertProjectRecord(project);
        await persistProjectToD1(project);
        return json({ pack }, 201);
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/scenario-packs/:packId/artifacts/:format", [
    requireAuth,
    ({ request, ctx, params }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const packId = String(params?.packId ?? "").trim();
      const format = String(params?.format ?? "").trim().toLowerCase();
      const pack = getScenarioPackById(principal.id, packId);

      if (!pack) {
        return json({ error: "Scenario pack not found." }, 404);
      }

      if (format === "md" || format === "markdown") {
        return new Response(pack.scenariosMarkdown, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename=\"${pack.id}-scenarios.md\"`,
          },
        });
      }

      if (format === "json") {
        const artifact = {
          packId: pack.id,
          manifestId: pack.manifestId,
          manifestHash: pack.manifestHash,
          repositoryFullName: pack.repositoryFullName,
          branch: pack.branch,
          headCommitSha: pack.headCommitSha,
          model: pack.model,
          generationAudit: pack.generationAudit,
          groupedByFeature: pack.groupedByFeature,
          groupedByOutcome: pack.groupedByOutcome,
          scenarios: pack.scenarios,
          generatedAt: pack.createdAt,
        };

        return new Response(JSON.stringify(artifact, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename=\"${pack.id}-scenarios.json\"`,
          },
        });
      }

      return json({ error: "Unsupported artifact format." }, 400);
    },
  ]),
  route("/api/projects/:projectId/scenario-runs", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({ data: listScenarioRunsForProject(principal.id, project.id) });
      }

      if (request.method === "POST") {
        return json(
          {
            error:
              "Deprecated endpoint. Synthetic scenario runs are disabled. Use /api/projects/:projectId/actions/execute/start.",
          },
          410,
        );
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/projects/:projectId/scenario-runs/clear", [
    requireAuth,
    async ({ request, ctx, params }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const forceParam = new URL(request.url).searchParams.get("force");
      const force =
        forceParam === "1" ||
        forceParam?.toLowerCase() === "true" ||
        forceParam?.toLowerCase() === "yes";
      const activeJobs = listActiveExecutionJobsForProject(principal.id, project.id);
      if (activeJobs.length > 0 && !force) {
        return json(
          {
            error:
              "Cannot delete run history while execution is active. Wait for active runs to finish first.",
            activeJobs: activeJobs.map((job) => ({
              id: job.id,
              status: job.status,
              updatedAt: job.updatedAt,
            })),
          },
          409,
        );
      }
      if (activeJobs.length > 0 && force) {
        const canceledAt = new Date().toISOString();
        for (const activeJob of activeJobs) {
          const next = await updateExecutionJobAndPersist(
            principal.id,
            activeJob.id,
            (draft) => {
              draft.status = "failed";
              draft.completedAt = canceledAt;
              draft.error = "Execution canceled by user while clearing project run history.";
            },
          );
          if (next) {
            await persistExecutionJobEvent({
              job: next,
              event: "error",
              phase: "execute.cancelled",
              status: "failed",
              message: "Execution canceled by user while clearing project run history.",
              payload: {
                error: "Execution canceled by user while clearing project run history.",
              },
              timestamp: canceledAt,
            });
          }
        }
      }

      const deletedInMemory = deleteProjectExecutionHistory(principal.id, project.id);
      const deletedInD1 = await deleteProjectExecutionHistoryFromD1(
        principal.id,
        project.id,
      );

      const totalDeleted = {
        scenarioRuns: Math.max(deletedInMemory.scenarioRuns, deletedInD1.scenarioRuns),
        executionJobs: Math.max(deletedInMemory.executionJobs, deletedInD1.executionJobs),
        executionJobEvents: Math.max(
          deletedInMemory.executionJobEvents,
          deletedInD1.executionJobEvents,
        ),
        fixAttempts: Math.max(deletedInMemory.fixAttempts, deletedInD1.fixAttempts),
        pullRequests: Math.max(deletedInMemory.pullRequests, deletedInD1.pullRequests),
      };

      project.activeScenarioRunId = null;
      project.updatedAt = new Date().toISOString();
      upsertProjectRecord(project);
      await persistProjectToD1(project);

      return json({ deleted: totalDeleted, project });
    },
  ]),
  route("/api/scenario-runs/:runId", [
    requireAuth,
    ({ request, ctx, params }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);
      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const runId = String(params?.runId ?? "").trim();
      const run = getScenarioRunById(principal.id, runId);

      if (!run) {
        return json({ error: "Scenario run not found." }, 404);
      }

      return json({ run });
    },
  ]),
  route("/api/projects/:projectId/fix-attempts", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({ data: listFixAttemptsForProject(principal.id, project.id) });
      }

      if (request.method === "POST") {
        return json(
          {
            error:
              "Deprecated endpoint. Synthetic fix attempts are disabled. Use /api/projects/:projectId/actions/execute/start.",
          },
          410,
        );
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/projects/:projectId/pull-requests", [
    requireAuth,
    async ({ request, ctx, params }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      if (request.method === "GET") {
        return json({ data: listPullRequestsForProject(principal.id, project.id) });
      }

      if (request.method === "POST") {
        return json(
          {
            error:
              "Deprecated endpoint. Synthetic pull request records are disabled. Use /api/projects/:projectId/actions/execute/start.",
          },
          410,
        );
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/projects/:projectId/review-board", [
    requireAuth,
    ({ request, ctx, params }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const packs = listScenarioPacksForProject(principal.id, project.id);
      const runs = listScenarioRunsForProject(principal.id, project.id);
      const pullRequests = listPullRequestsForProject(principal.id, project.id);
      const board = buildReviewBoard(project, packs, runs, pullRequests);

      return json({ board });
    },
  ]),
  route("/api/projects/:projectId/review-report", [
    requireAuth,
    ({ request, ctx, params }) => {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);

      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const packs = listScenarioPacksForProject(principal.id, project.id);
      const runs = listScenarioRunsForProject(principal.id, project.id);
      const pullRequests = listPullRequestsForProject(principal.id, project.id);
      const manifest = getLatestSourceManifestForProject(principal.id, project.id);
      const board = buildReviewBoard(project, packs, runs, pullRequests);
      const markdown = buildChallengeReport(
        project,
        manifest,
        board,
        runs[0] ?? null,
        pullRequests,
      );
      const requestedFormat = new URL(request.url).searchParams.get("format");
      const format = String(requestedFormat ?? "").trim().toLowerCase();
      if (format === "md" || format === "markdown") {
        return new Response(markdown, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename=\"${project.id}-challenge-report.md\"`,
          },
        });
      }

      return json({
        markdown,
        generatedAt: new Date().toISOString(),
      });
    },
  ]),
  render(Document, [
    route("/", Home),
    layout(AppShell, [
      route("/dashboard", DashboardPage),
      ...(prefix("/projects/:projectId", [
        route("/connect", ConnectPage),
        route("/sources", SourcesPage),
        route("/generate", GeneratePage),
        route("/review", ReviewPage),
        route("/execute", ExecutePage),
        route("/completed", CompletedPage),
      ]) as any[]),
    ]),
  ]),
]);
