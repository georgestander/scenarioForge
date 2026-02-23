import { env } from "cloudflare:workers";
import type { AuthPrincipal, CodexSession, Project } from "@/domain/models";
import { hydrateCoreState } from "@/services/store";

const DURABLE_CORE_KEY = "__SCENARIOFORGE_DURABLE_CORE_STATE__";
const HYDRATE_TTL_MS = 3000;

interface DurableCoreState {
  tablesReady: boolean;
  lastHydratedAt: number;
}

const nowIso = () => new Date().toISOString();

const getState = (): DurableCoreState => {
  const host = globalThis as typeof globalThis & {
    [DURABLE_CORE_KEY]?: DurableCoreState;
  };

  if (!host[DURABLE_CORE_KEY]) {
    host[DURABLE_CORE_KEY] = {
      tablesReady: false,
      lastHydratedAt: 0,
    };
  }

  return host[DURABLE_CORE_KEY];
};

const getDb = (): D1Database | null => env.SCENARIOFORGE_DB ?? null;

const safeParseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const ensureTables = async (db: D1Database): Promise<void> => {
  const state = getState();

  if (state.tablesReady) {
    return;
  }

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_principals (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        repo_url TEXT,
        default_branch TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_codex_sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        transport TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        initialize_request_json TEXT NOT NULL,
        thread_start_request_json TEXT NOT NULL,
        preferred_models_json TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_auth_sessions (
        session_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  state.tablesReady = true;
};

export const hydrateCoreStateFromD1 = async (): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);

  const state = getState();
  if (Date.now() - state.lastHydratedAt < HYDRATE_TTL_MS) {
    return;
  }

  const principalRows = await db
    .prepare(
      `
      SELECT id, provider, display_name, email, created_at, updated_at
      FROM sf_principals
    `,
    )
    .all();
  const projectRows = await db
    .prepare(
      `
      SELECT id, owner_id, name, repo_url, default_branch, status, created_at, updated_at
      FROM sf_projects
    `,
    )
    .all();
  const sessionRows = await db
    .prepare(
      `
      SELECT
        id,
        owner_id,
        project_id,
        status,
        transport,
        created_at,
        updated_at,
        initialize_request_json,
        thread_start_request_json,
        preferred_models_json
      FROM sf_codex_sessions
    `,
    )
    .all();

  const principals: AuthPrincipal[] = (principalRows.results as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider) as AuthPrincipal["provider"],
      displayName: String(row.display_name),
      email: row.email ? String(row.email) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));

  const projects: Project[] = (projectRows.results as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      ownerId: String(row.owner_id),
      name: String(row.name),
      repoUrl: row.repo_url ? String(row.repo_url) : null,
      defaultBranch: String(row.default_branch),
      status: String(row.status) as Project["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }),
  );

  const sessions: CodexSession[] = (sessionRows.results as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      ownerId: String(row.owner_id),
      projectId: String(row.project_id),
      status: String(row.status) as CodexSession["status"],
      transport: String(row.transport) as CodexSession["transport"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      initializeRequest: safeParseJson(
        String(row.initialize_request_json),
        {
          method: "initialize",
          id: 1,
          params: {},
        },
      ),
      threadStartRequest: safeParseJson(
        String(row.thread_start_request_json),
        {
          method: "thread/start",
          id: 2,
          params: {},
        },
      ),
      preferredModels: safeParseJson(String(row.preferred_models_json), {
        research: "codex spark",
        implementation: "gpt-5.3-xhigh",
      }),
    }),
  );

  hydrateCoreState({
    principals,
    projects,
    sessions,
  });

  state.lastHydratedAt = Date.now();
};

export const persistPrincipalToD1 = async (
  principal: AuthPrincipal,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_principals (
        id, provider, display_name, email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      principal.id,
      principal.provider,
      principal.displayName,
      principal.email,
      principal.createdAt,
      principal.updatedAt || nowIso(),
    )
    .run();
};

export const persistProjectToD1 = async (project: Project): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_projects (
        id, owner_id, name, repo_url, default_branch, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        name = excluded.name,
        repo_url = excluded.repo_url,
        default_branch = excluded.default_branch,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      project.id,
      project.ownerId,
      project.name,
      project.repoUrl,
      project.defaultBranch,
      project.status,
      project.createdAt,
      project.updatedAt || nowIso(),
    )
    .run();
};

export const persistCodexSessionToD1 = async (
  session: CodexSession,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_codex_sessions (
        id,
        owner_id,
        project_id,
        status,
        transport,
        created_at,
        updated_at,
        initialize_request_json,
        thread_start_request_json,
        preferred_models_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        status = excluded.status,
        transport = excluded.transport,
        updated_at = excluded.updated_at,
        initialize_request_json = excluded.initialize_request_json,
        thread_start_request_json = excluded.thread_start_request_json,
        preferred_models_json = excluded.preferred_models_json
    `,
    )
    .bind(
      session.id,
      session.ownerId,
      session.projectId,
      session.status,
      session.transport,
      session.createdAt,
      session.updatedAt || nowIso(),
      JSON.stringify(session.initializeRequest),
      JSON.stringify(session.threadStartRequest),
      JSON.stringify(session.preferredModels),
    )
    .run();
};
