import { render, route } from "rwsdk/router";
import type { RouteMiddleware } from "rwsdk/router";
import type { RequestInfo } from "rwsdk/worker";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { Home } from "@/app/pages/home";
import type { AuthPrincipal, AuthSession, GitHubConnection } from "@/domain/models";
import { createAuthSession, clearAuthSession, loadAuthSession, saveAuthSession } from "@/services/auth";
import { startCodexSession } from "@/services/codexSession";
import { createFixAttemptFromRun, createPullRequestFromFix } from "@/services/fixPipeline";
import {
  connectGitHubInstallation,
  consumeGitHubConnectState,
  getGitHubInstallUrl,
  issueGitHubConnectState,
} from "@/services/githubApp";
import { buildChallengeReport, buildReviewBoard } from "@/services/reviewBoard";
import { createScenarioRunRecord } from "@/services/runEngine";
import { generateScenarioPack } from "@/services/scenarioGeneration";
import {
  buildSourceManifest,
  scanSourcesForProject,
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
  getLatestSourceManifestForProject,
  getPrincipalById,
  getProjectByIdForOwner,
  getScenarioPackById,
  getScenarioRunById,
  getSourceManifestById,
  listCodexSessionsForOwner,
  listFixAttemptsForProject,
  listProjectsForOwner,
  listPullRequestsForProject,
  listScenarioPacksForProject,
  listScenarioRunsForProject,
  listSourceManifestsForProject,
  listSourcesForProject,
  updateSourceSelections,
  upsertGitHubConnection,
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

  ctx.auth = {
    session,
    principal,
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
    post: async ({ request, response }) => {
      const payload = await parseJsonBody(request);
      const displayName =
        String(payload?.displayName ?? "").trim() || "ScenarioForge Builder";
      const email = String(payload?.email ?? "").trim().toLowerCase() || null;

      const principal = createPrincipal({
        provider: "chatgpt",
        displayName,
        email,
      });

      await saveAuthSession(response.headers, createAuthSession(principal.id));

      return json({
        authenticated: true,
        principal,
      });
    },
  }),
  route("/api/auth/sign-out", {
    post: async ({ request, response }) => {
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

        return json({ project }, 201);
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/codex/sessions", [
    requireAuth,
    async ({ request, ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      if (request.method === "GET") {
        return json({ data: listCodexSessionsForOwner(principal.id) });
      }

      if (request.method === "POST") {
        const payload = await parseJsonBody(request);
        const projectId = String(payload?.projectId ?? "").trim();

        if (!projectId) {
          return json({ error: "projectId is required" }, 400);
        }

        try {
          const session = startCodexSession({
            ownerId: principal.id,
            projectId,
          });
          return json({ session }, 201);
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to initialize Codex session",
            },
            400,
          );
        }
      }

      return json({ error: "Method not allowed." }, 405);
    },
  ]),
  route("/api/github/connect/start", [
    requireAuth,
    ({ request, ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const url = new URL(request.url);
      const forceReconnect = url.searchParams.get("force") === "1";
      const existing = getGitHubConnectionForPrincipal(principal.id);

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
  route("/api/github/connect/callback", [
    async ({ request, ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return githubCallbackRedirect(request, "error", "auth_required");
      }

      const url = new URL(request.url);
      const installationId = Number(url.searchParams.get("installation_id"));
      const state = url.searchParams.get("state") ?? "";

      if (!state) {
        return githubCallbackRedirect(request, "error", "state_required");
      }

      if (!consumeGitHubConnectState(state, principal.id)) {
        return githubCallbackRedirect(request, "error", "state_invalid_or_expired");
      }

      if (!Number.isInteger(installationId) || installationId <= 0) {
        return githubCallbackRedirect(
          request,
          "error",
          "installation_id_invalid",
        );
      }

      try {
        const connectionResult = await connectGitHubInstallation(installationId);

        upsertGitHubConnection({
          principalId: principal.id,
          accountLogin: connectionResult.accountLogin,
          installationId,
          accessToken: connectionResult.accessToken,
          accessTokenExpiresAt: connectionResult.accessTokenExpiresAt,
          repositories: connectionResult.repositories,
        });

        return githubCallbackRedirect(request, "connected");
      } catch {
        return githubCallbackRedirect(request, "error", "connect_failed");
      }
    },
  ]),
  route("/api/github/connection", [
    requireAuth,
    ({ ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const connection = getGitHubConnectionForPrincipal(principal.id);
      return json({ connection: githubConnectionView(connection) });
    },
  ]),
  route("/api/github/repos", [
    requireAuth,
    ({ ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      const connection = getGitHubConnectionForPrincipal(principal.id);

      return json({
        data: connection?.repositories ?? [],
      });
    },
  ]),
  route("/api/github/disconnect", [
    requireAuth,
    ({ request, ctx }) => {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
      }

      disconnectGitHubConnectionForPrincipal(principal.id);
      return json({ ok: true });
    },
  ]),
  route("/api/projects/:projectId/sources/scan", [
    requireAuth,
    ({ request, ctx, params }) => {
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

      const repositories =
        getGitHubConnectionForPrincipal(principal.id)?.repositories ?? [];
      const scanned = scanSourcesForProject(project, principal.id, repositories);
      const data = upsertProjectSources({
        ownerId: principal.id,
        projectId: project.id,
        sources: scanned,
      });

      return json({ data });
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
        const manifestInput = buildSourceManifest({
          ownerId: principal.id,
          projectId: project.id,
          selectedSources: finalSelectedSources,
          userConfirmed,
          confirmationNote,
        });

        const manifest = createSourceManifest(manifestInput);

        return json({
          manifest,
          selectedSources: finalSelectedSources,
          includesStale: validation.includesStale,
        });
      }

      return json({ error: "Method not allowed." }, 405);
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

        if (sources.length === 0) {
          return json({ error: "Manifest contains no selected sources." }, 400);
        }

        const scenarioPackInput = generateScenarioPack(
          project,
          principal.id,
          manifest,
          sources,
        );
        const pack = createScenarioPack(scenarioPackInput);
        return json({ pack }, 201);
      }

      return json({ error: "Method not allowed." }, 405);
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
      const markdown = buildChallengeReport(project, manifest, board, runs[0] ?? null);

      return json({
        markdown,
        generatedAt: new Date().toISOString(),
      });
    },
  ]),
  render(Document, [route("/", Home)]),
]);
