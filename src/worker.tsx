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
import {
  connectGitHubInstallation,
  consumeGitHubConnectState,
  getGitHubInstallUrl,
  issueGitHubConnectState,
} from "@/services/githubApp";
import {
  createPrincipal,
  createProject,
  disconnectGitHubConnectionForPrincipal,
  getGitHubConnectionForPrincipal,
  getPrincipalById,
  listCodexSessionsForOwner,
  listProjectsForOwner,
  upsertGitHubConnection,
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

const getPrincipalFromContext = (ctx: AppContext): AuthPrincipal | null =>
  ctx.auth?.principal ?? null;

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
      phase: "phase-1",
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
    ({ ctx }) => {
      const principal = getPrincipalFromContext(ctx);

      if (!principal) {
        return json({ error: "Authentication required." }, 401);
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
      } catch (error) {
        return githubCallbackRedirect(
          request,
          "error",
          error instanceof Error ? "connect_failed" : "unknown_error",
        );
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
  render(Document, [route("/", Home)]),
]);
