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
  GitHubConnection,
  Project,
  ScenarioPack,
} from "@/domain/models";
import { createAuthSession, clearAuthSession, loadAuthSession, saveAuthSession } from "@/services/auth";
import {
  hydrateCoreStateFromD1,
  persistPrincipalToD1,
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
import { createFixAttemptFromRun, createPullRequestFromFix } from "@/services/fixPipeline";
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
import { isCodeFirstGenerationEnabled } from "@/services/featureFlags";
import { evaluateProjectPrReadiness } from "@/services/prReadiness";
import { buildChallengeReport, buildReviewBoard } from "@/services/reviewBoard";
import { createScenarioRunRecord } from "@/services/runEngine";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import {
  buildSourceManifest,
  scanSourcesAndCodeBaselineForProject,
  validateGenerationSelection,
} from "@/services/sourceGate";
import {
  createFixAttempt,
  createPrincipal,
  createProject,
  createPullRequestRecord,
  createScenarioPack,
  createScenarioRun,
  createSourceManifest,
  disconnectGitHubConnectionForPrincipal,
  getFixAttemptById,
  getGitHubConnectionForPrincipal,
  getLatestCodeBaselineForProject,
  getLatestGitHubConnectionForPrincipal,
  getLatestProjectPrReadinessForProject,
  getLatestSourceManifestForProject,
  getPrincipalById,
  getProjectByIdForOwner,
  getScenarioPackById,
  getScenarioRunById,
  getSourceManifestById,
  listFixAttemptsForProject,
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

const normalizeRunItemStatus = (value: unknown): "passed" | "failed" | "blocked" => {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if (status === "passed" || status === "failed" || status === "blocked") {
    return status;
  }
  return "blocked";
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

  if (!runRecord) {
    throw new Error("Codex execute output is missing run details.");
  }

  const rawItems = Array.isArray(runRecord.items) ? runRecord.items : [];
  if (rawItems.length === 0) {
    throw new Error("Codex execute output did not include run.items.");
  }

  const parsedItemMap = rawItems
    .map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`Codex execute output has invalid run item at index ${index}.`);
      }

      const scenarioId = String(item.scenarioId ?? "").trim();
      const scenario = scenariosById.get(scenarioId);
      if (!scenario) {
        throw new Error(
          `Codex execute output referenced unknown scenarioId '${scenarioId}'.`,
        );
      }

      const timestamp = new Date(now.getTime() + index * 250).toISOString();
      const status = normalizeRunItemStatus(item.status);
      const observed = String(item.observed ?? "").trim() || "No observed output captured.";
      const expected = String(item.expected ?? "").trim() || scenario.passCriteria;

      return {
        scenarioId,
        status,
        startedAt: timestamp,
        completedAt: timestamp,
        observed,
        expected,
        failureHypothesis:
          item.failureHypothesis === null
            ? null
            : String(item.failureHypothesis ?? "").trim() || null,
        artifacts: normalizeArtifacts(item.artifacts),
      };
    })
    .filter(
      (
        item,
      ): item is {
        scenarioId: string;
        status: "passed" | "failed" | "blocked";
        startedAt: string;
        completedAt: string;
        observed: string;
        expected: string;
        failureHypothesis: string | null;
        artifacts: Array<{ kind: "log" | "screenshot" | "trace"; label: string; value: string }>;
      } => Boolean(item),
    )
    .reduce((acc, item) => {
      if (acc.has(item.scenarioId)) {
        throw new Error(
          `Codex execute output contains duplicate scenarioId '${item.scenarioId}'.`,
        );
      }
      acc.set(item.scenarioId, item);
      return acc;
    }, new Map<string, {
      scenarioId: string;
      status: "passed" | "failed" | "blocked";
      startedAt: string;
      completedAt: string;
      observed: string;
      expected: string;
      failureHypothesis: string | null;
      artifacts: Array<{ kind: "log" | "screenshot" | "trace"; label: string; value: string }>;
    }>());

  // Ensure every scenario reaches a terminal state even if Codex omits some run items.
  const items = pack.scenarios.map((scenario, index) => {
    const existing = parsedItemMap.get(scenario.id);
    if (existing) {
      return existing;
    }

    const timestamp = new Date(now.getTime() + index * 250).toISOString();
    return {
      scenarioId: scenario.id,
      status: "blocked" as const,
      startedAt: timestamp,
      completedAt: timestamp,
      observed: "Codex execute output omitted this scenario result. Marked blocked for explicit rerun.",
      expected: scenario.passCriteria,
      failureHypothesis: "Missing run item for scenario in Codex execute output.",
      artifacts: [],
    };
  });

  const computedSummary = items.reduce(
    (acc, item) => {
      if (item.status === "passed") {
        acc.passed += 1;
      } else if (item.status === "failed") {
        acc.failed += 1;
      } else if (item.status === "blocked") {
        acc.blocked += 1;
      }
      return acc;
    },
    { total: items.length, passed: 0, failed: 0, blocked: 0 },
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
    return {
      ownerId,
      projectId,
      scenarioRunId: run.id,
      failedScenarioIds: failedScenarioIdsFromRun,
      probableRootCause:
        "Codex execute reported failed scenarios but did not emit fixAttempt details.",
      patchSummary:
        "No fix details available from Codex output. Review execute transcript.",
      impactedFiles: [],
      model: "gpt-5.3-xhigh",
      status: "failed" as const,
      rerunSummary: null,
    };
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

      if (!title) {
        return null;
      }

      const providedStatus = normalizePullRequestStatus(record.status);
      const status = !url ? "blocked" : providedStatus;
      const normalizedRiskNotes =
        riskNotes.length > 0
          ? riskNotes
          : !url
            ? [
                "Automatic PR creation unavailable.",
                "Push branch manually and open PR using the generated branch name.",
              ]
            : [];

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
        status,
        rootCauseSummary:
          String(record.rootCauseSummary ?? "").trim() ||
          fixAttempt.probableRootCause,
        rerunEvidenceRunId: fixAttempt.rerunSummary?.runId ?? null,
        rerunEvidenceSummary,
        riskNotes: normalizedRiskNotes,
      };
    })
    .filter(
      (
        record,
      ): record is PullRequestCreateInput => Boolean(record),
    );

  const coveredScenarioIds = new Set(results.flatMap((record) => record.scenarioIds));
  const missingScenarioIds = fixAttempt.failedScenarioIds.filter(
    (scenarioId) => !coveredScenarioIds.has(scenarioId),
  );
  const synthesizedFallbacks = missingScenarioIds.map((scenarioId) => ({
    ownerId,
    projectId,
    fixAttemptId: fixAttempt.id,
    scenarioIds: [scenarioId],
    title: `Manual PR handoff for ${scenarioId}`,
    branchName: `scenariofix/${fixAttempt.id}/${scenarioId.toLowerCase()}`,
    url: "",
    status: "blocked" as const,
    rootCauseSummary: fixAttempt.probableRootCause,
    rerunEvidenceRunId: fixAttempt.rerunSummary?.runId ?? null,
    rerunEvidenceSummary,
    riskNotes: [
      `Automatic PR creation unavailable for ${scenarioId}.`,
      `Create branch '${`scenariofix/${fixAttempt.id}/${scenarioId.toLowerCase()}`}' and open PR manually.`,
    ],
  }));

  return [...results, ...synthesizedFallbacks];
};

const getPrincipalFromContext = (ctx: AppContext): AuthPrincipal | null =>
  ctx.auth?.principal ?? null;

const getProjectId = (params: Record<string, unknown> | undefined): string =>
  String(params?.projectId ?? "").trim();

const githubConnectionView = (connection: GitHubConnection | null) => {
  if (!connection) {
    return null;
  }

  return {
    id: connection.id,
    principalId: connection.principalId,
    provider: connection.provider,
    status: connection.status,
    accountLogin: connection.accountLogin,
    installationId: connection.installationId,
    accessTokenExpiresAt: connection.accessTokenExpiresAt,
    repositories: connection.repositories,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
};

const GITHUB_TOKEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;

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
  if (!connection.accessToken.trim()) {
    return true;
  }

  const expiresAt = connection.accessTokenExpiresAt;
  if (!expiresAt) {
    return true;
  }

  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return parsed <= Date.now() + GITHUB_TOKEN_REFRESH_WINDOW_MS;
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
  return upsertProjectPrReadinessCheck(readinessInput);
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

  const principal = getPrincipalById(session.principalId);

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
      try {
        await logoutChatGpt();
      } catch {
        // Keep local sign-out reliable even if remote logout cannot be reached.
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

      if (name !== undefined) project.name = name;
      if (repoUrl !== undefined) project.repoUrl = repoUrl;
      if (defaultBranch !== undefined) project.defaultBranch = defaultBranch;
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
        if (isCodeFirstGenerationEnabled() && !codeBaseline) {
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

      const projectId = getProjectId(params);
      const project = getProjectByIdForOwner(projectId, principal.id);
      if (!project) {
        return json({ error: "Project not found." }, 404);
      }

      const payload = await parseJsonBody(request);
      const manifestId =
        String(payload?.sourceManifestId ?? payload?.manifestId ?? "").trim();
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

      const modeValue = String(payload?.mode ?? "initial")
        .trim()
        .toLowerCase();
      const mode = modeValue === "update" ? "update" : "initial";
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
      const existingPack =
        mode === "update"
          ? scenarioPackId
            ? getScenarioPackById(principal.id, scenarioPackId)
            : listScenarioPacksForProject(principal.id, project.id)[0] ?? null
          : null;

      const githubConnection = await ensureGitHubConnectionForPrincipal(principal.id);
      if (!githubConnection) {
        return json({ error: "Connect GitHub before generating scenarios." }, 400);
      }

      return createSseResponse(async (emit) => {
        emit("started", {
          action: "generate",
          mode,
          timestamp: new Date().toISOString(),
        });

        const attemptErrors: string[] = [];
        let scenarioPackInput: ReturnType<typeof generateScenarioPack> | null = null;

        for (const useSkill of [true, false]) {
          const attempt = useSkill ? "skill-first" : "fallback";
          emit("status", {
            action: "generate",
            phase: "attempt.start",
            attempt,
            timestamp: new Date().toISOString(),
          });

          try {
            const codexGeneration = await generateScenariosViaCodexStream(
              {
                project,
                manifest,
                selectedSources,
                githubToken: githubConnection.accessToken,
                mode,
                userInstruction,
                existingPack,
                useSkill,
              },
              (event) => {
                emit("codex", {
                  action: "generate",
                  attempt,
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

            emit("status", {
              action: "generate",
              phase: "attempt.success",
              attempt,
              timestamp: new Date().toISOString(),
            });
            break;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "generation failed";
            attemptErrors.push(`[${attempt}] ${message}`);
            emit("status", {
              action: "generate",
              phase: "attempt.error",
              attempt,
              error: message,
              timestamp: new Date().toISOString(),
            });
          }
        }

        if (!scenarioPackInput) {
          emit("error", {
            action: "generate",
            error: [
              "Failed to generate scenarios through Codex app-server.",
              ...attemptErrors,
            ].join(" "),
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const pack = createScenarioPack(scenarioPackInput);
        emit("persisted", {
          action: "generate",
          packId: pack.id,
          scenarioCount: pack.scenarios.length,
          timestamp: new Date().toISOString(),
        });
        emit("completed", {
          pack,
          mode,
          userInstruction: userInstruction || null,
          timestamp: new Date().toISOString(),
        });
      });
    },
  ]),
  route("/api/projects/:projectId/actions/execute/stream", [
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
      const pack =
        (scenarioPackId
          ? getScenarioPackById(principal.id, scenarioPackId)
          : listScenarioPacksForProject(principal.id, project.id)[0]) ?? null;

      if (!pack || pack.projectId !== project.id) {
        return json({ error: "Scenario pack not found." }, 404);
      }

      const executionMode = normalizeExecutionMode(payload?.executionMode);
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const constraints = isRecord(payload?.constraints) ? payload.constraints : {};
      const readiness = await refreshProjectPrReadiness(principal.id, project);

      if (executionMode === "full" && readiness.status !== "ready") {
        return json(
          {
            error: `PR automation readiness is required for executionMode=full. ${readiness.reasons.join(" ")}`.trim(),
            readiness,
          },
          409,
        );
      }

      return createSseResponse(async (emit) => {
        emit("started", {
          action: "execute",
          executionMode,
          timestamp: new Date().toISOString(),
        });
        for (const scenario of pack.scenarios) {
          emit("status", {
            action: "execute",
            phase: "run.queue",
            scenarioId: scenario.id,
            stage: "run",
            status: "queued",
            message: `${scenario.id} queued`,
            timestamp: new Date().toISOString(),
          });
        }

        const codexExecution = await executeScenariosViaCodexStream(
          {
            project,
            pack,
            executionMode,
            userInstruction,
            constraints,
          },
          (event) => {
            emit("codex", {
              action: "execute",
              event: event.event,
              payload: event.payload,
              timestamp: new Date().toISOString(),
            });
          },
        );

        const runInput = buildScenarioRunInputFromCodexOutput(
          principal.id,
          project.id,
          pack,
          codexExecution.parsedOutput,
        );
        const run = createScenarioRun(runInput);
        for (const item of run.items) {
          emit("status", {
            action: "execute",
            phase: "run.result",
            scenarioId: item.scenarioId,
            stage: "run",
            status: item.status,
            message: item.observed,
            timestamp: item.completedAt,
          });
        }
        emit("persisted", {
          action: "execute",
          kind: "run",
          runId: run.id,
          summary: run.summary,
          timestamp: new Date().toISOString(),
        });

        let fixAttempt: ReturnType<typeof createFixAttempt> | null = null;
        if (executionMode === "fix" || executionMode === "pr" || executionMode === "full") {
          const fixInput = buildFixAttemptInputFromCodexOutput(
            principal.id,
            project.id,
            run,
            codexExecution.parsedOutput,
          );
          if (fixInput) {
            fixAttempt = createFixAttempt(fixInput);
            for (const scenarioId of fixAttempt.failedScenarioIds) {
              emit("status", {
                action: "execute",
                phase: "fix.progress",
                scenarioId,
                stage: "fix",
                status: "running",
                message: fixAttempt.patchSummary,
                timestamp: new Date().toISOString(),
              });
            }
            if (fixAttempt.rerunSummary) {
              const rerunStatus = fixAttempt.rerunSummary.failed > 0 ? "failed" : "passed";
              for (const scenarioId of fixAttempt.failedScenarioIds) {
                emit("status", {
                  action: "execute",
                  phase: "rerun.result",
                  scenarioId,
                  stage: "rerun",
                  status: rerunStatus,
                  message: `Rerun summary: ${fixAttempt.rerunSummary.passed} passed, ${fixAttempt.rerunSummary.failed} failed, ${fixAttempt.rerunSummary.blocked} blocked.`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
            emit("persisted", {
              action: "execute",
              kind: "fixAttempt",
              fixAttemptId: fixAttempt.id,
              timestamp: new Date().toISOString(),
            });
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
          for (const pr of pullRequests) {
            for (const scenarioId of pr.scenarioIds) {
              emit("status", {
                action: "execute",
                phase: "pr.result",
                scenarioId,
                stage: "pr",
                status: pr.url ? "passed" : "blocked",
                message: pr.url ? `PR ready: ${pr.title}` : `PR blocked: ${pr.title}`,
                timestamp: new Date().toISOString(),
              });
            }
          }
          emit("persisted", {
            action: "execute",
            kind: "pullRequests",
            count: pullRequests.length,
            timestamp: new Date().toISOString(),
          });
        }

        emit("completed", {
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
          timestamp: new Date().toISOString(),
        });
      });
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
      const manifestId =
        String(payload?.sourceManifestId ?? payload?.manifestId ?? "").trim();
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

      const modeValue = String(payload?.mode ?? "initial")
        .trim()
        .toLowerCase();
      const mode = modeValue === "update" ? "update" : "initial";
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
      const existingPack =
        mode === "update"
          ? scenarioPackId
            ? getScenarioPackById(principal.id, scenarioPackId)
            : listScenarioPacksForProject(principal.id, project.id)[0] ?? null
          : null;

      const githubConnection = await ensureGitHubConnectionForPrincipal(principal.id);
      if (!githubConnection) {
        return json({ error: "Connect GitHub before generating scenarios." }, 400);
      }

      let scenarioPackInput:
        | ReturnType<typeof generateScenarioPack>
        | null = null;
      const attemptErrors: string[] = [];

      for (const useSkill of [true, false]) {
        try {
          const codexGeneration = await generateScenariosViaCodex({
            project,
            manifest,
            selectedSources,
            githubToken: githubConnection.accessToken,
            mode,
            userInstruction,
            existingPack,
            useSkill,
          });

          scenarioPackInput = generateScenarioPack({
            project,
            ownerId: principal.id,
            manifest,
            selectedSources,
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
          break;
        } catch (error) {
          attemptErrors.push(
            error instanceof Error
              ? `[${useSkill ? "skill-first" : "fallback"}] ${error.message}`
              : `[${useSkill ? "skill-first" : "fallback"}] generation failed`,
          );
        }
      }

      if (!scenarioPackInput) {
        return json(
          {
            error: [
              "Failed to generate scenarios through Codex app-server.",
              ...attemptErrors,
            ].join(" "),
          },
          502,
        );
      }

      const pack = createScenarioPack(scenarioPackInput);
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
      const pack =
        (scenarioPackId
          ? getScenarioPackById(principal.id, scenarioPackId)
          : listScenarioPacksForProject(principal.id, project.id)[0]) ?? null;

      if (!pack || pack.projectId !== project.id) {
        return json({ error: "Scenario pack not found." }, 404);
      }

      const executionMode = normalizeExecutionMode(payload?.executionMode);
      const userInstruction = String(payload?.userInstruction ?? "").trim();
      const constraints = isRecord(payload?.constraints) ? payload.constraints : {};
      const readiness = await refreshProjectPrReadiness(principal.id, project);

      if (executionMode === "full" && readiness.status !== "ready") {
        return json(
          {
            error: `PR automation readiness is required for executionMode=full. ${readiness.reasons.join(" ")}`.trim(),
            readiness,
          },
          409,
        );
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
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to execute scenarios through Codex app-server.",
          },
          502,
        );
      }

      const runInput = buildScenarioRunInputFromCodexOutput(
        principal.id,
        project.id,
        pack,
        codexExecution.parsedOutput,
      );
      const run = createScenarioRun(runInput);

      let fixAttempt: ReturnType<typeof createFixAttempt> | null = null;
      if (executionMode === "fix" || executionMode === "pr" || executionMode === "full") {
        const fixInput = buildFixAttemptInputFromCodexOutput(
          principal.id,
          project.id,
          run,
          codexExecution.parsedOutput,
        );
        if (fixInput) {
          fixAttempt = createFixAttempt(fixInput);
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
        const manifestId = String(payload?.manifestId ?? "").trim();
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

        const githubConnection = await ensureGitHubConnectionForPrincipal(
          principal.id,
        );
        if (!githubConnection) {
          return json(
            { error: "Connect GitHub before generating scenarios." },
            400,
          );
        }

        const attemptErrors: string[] = [];
        let scenarioPackInput:
          | ReturnType<typeof generateScenarioPack>
          | null = null;

        for (const useSkill of [true, false]) {
          try {
            const codexGeneration = await generateScenariosViaCodex({
              project,
              manifest,
              selectedSources: sources,
              githubToken: githubConnection.accessToken,
              useSkill,
            });

            scenarioPackInput = generateScenarioPack({
              project,
              ownerId: principal.id,
              manifest,
              selectedSources: sources,
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
            break;
          } catch (error) {
            attemptErrors.push(
              error instanceof Error
                ? `[${useSkill ? "skill-first" : "fallback"}] ${error.message}`
                : `[${useSkill ? "skill-first" : "fallback"}] generation failed`,
            );
          }
        }

        if (!scenarioPackInput) {
          return json(
            {
              error: [
                "Failed to generate scenarios through Codex app-server.",
                ...attemptErrors,
              ].join(" "),
            },
            502,
          );
        }

        const pack = createScenarioPack(scenarioPackInput);
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
        const payload = await parseJsonBody(request);
        const scenarioPackId = String(payload?.scenarioPackId ?? "").trim();
        const scenarioIds = readStringArray(payload?.scenarioIds);
        const pack = getScenarioPackById(principal.id, scenarioPackId);

        if (!pack || pack.projectId !== project.id) {
          return json({ error: "Scenario pack not found." }, 404);
        }

        const runInput = createScenarioRunRecord({
          ownerId: principal.id,
          projectId: project.id,
          pack,
          selectedScenarioIds: scenarioIds,
        });
        const run = createScenarioRun(runInput);

        return json({ run }, 201);
      }

      return json({ error: "Method not allowed." }, 405);
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
        const payload = await parseJsonBody(request);
        const runId = String(payload?.runId ?? "").trim();
        const run = getScenarioRunById(principal.id, runId);

        if (!run || run.projectId !== project.id) {
          return json({ error: "Scenario run not found." }, 404);
        }

        const fixAttemptInput = createFixAttemptFromRun({
          ownerId: principal.id,
          projectId: project.id,
          run,
        });
        const fixAttempt = createFixAttempt(fixAttemptInput);
        return json({ fixAttempt }, 201);
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
        const payload = await parseJsonBody(request);
        const fixAttemptId = String(payload?.fixAttemptId ?? "").trim();
        const fixAttempt = getFixAttemptById(principal.id, fixAttemptId);

        if (!fixAttempt || fixAttempt.projectId !== project.id) {
          return json({ error: "Fix attempt not found." }, 404);
        }

        if (!fixAttempt.rerunSummary) {
          return json(
            { error: "Fix attempt missing rerun evidence. Cannot create PR." },
            400,
          );
        }

        const pullRequestInput = createPullRequestFromFix({
          ownerId: principal.id,
          projectId: project.id,
          fixAttempt,
        });
        const pullRequest = createPullRequestRecord(pullRequestInput);
        return json({ pullRequest }, 201);
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
