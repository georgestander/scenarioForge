import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { Home } from "@/app/pages/home";
import { listCodexSessions, listProjects, createProject } from "@/services/store";
import { startCodexSession } from "@/services/codexSession";

export type AppContext = {};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const methodNotAllowed = (): Response =>
  json({ error: "Method not allowed." }, 405);

const parseJsonBody = async (
  request: Request,
): Promise<Record<string, unknown> | null> => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export default defineApp([
  setCommonHeaders(),
  ({ ctx }) => {
    ctx;
  },
  route("/api/health", () =>
    json({
      ok: true,
      service: "scenarioforge-api",
      phase: "phase-0",
      timestamp: new Date().toISOString(),
    }),
  ),
  route("/api/projects", async ({ request }) => {
    if (request.method === "GET") {
      return json({ data: listProjects() });
    }

    if (request.method === "POST") {
      const payload = await parseJsonBody(request);
      const rawName = String(payload?.name ?? "").trim();

      if (!rawName) {
        return json({ error: "name is required" }, 400);
      }

      const repoUrl = String(payload?.repoUrl ?? "").trim() || null;
      const defaultBranch = String(payload?.defaultBranch ?? "main").trim() || "main";

      const project = createProject({
        name: rawName,
        repoUrl,
        defaultBranch,
      });

      return json({ project }, 201);
    }

    return methodNotAllowed();
  }),
  route("/api/codex/sessions", async ({ request }) => {
    if (request.method === "GET") {
      return json({ data: listCodexSessions() });
    }

    if (request.method === "POST") {
      const payload = await parseJsonBody(request);
      const projectId = String(payload?.projectId ?? "").trim();

      if (!projectId) {
        return json({ error: "projectId is required" }, 400);
      }

      try {
        const session = startCodexSession({ projectId });
        return json({ session }, 201);
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : "Failed to initialize Codex session",
          },
          400,
        );
      }
    }

    return methodNotAllowed();
  }),
  render(Document, [route("/", Home)]),
]);
