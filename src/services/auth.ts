import { env } from "cloudflare:workers";
import { defineSessionStore } from "rwsdk/auth";
import type { AuthSession } from "@/domain/models";
import { hydrateCoreStateFromD1, persistPrincipalToD1 } from "@/services/durableCore";
import { getPrincipalById } from "@/services/store";

const AUTH_STATE_KEY = "__SCENARIOFORGE_AUTH_STATE__";

interface AuthState {
  sessions: Map<string, AuthSession>;
  tableReady: boolean;
}

const nowIso = () => new Date().toISOString();

const getAuthState = (): AuthState => {
  const host = globalThis as typeof globalThis & {
    [AUTH_STATE_KEY]?: AuthState;
  };

  if (!host[AUTH_STATE_KEY]) {
    host[AUTH_STATE_KEY] = {
      sessions: new Map<string, AuthSession>(),
      tableReady: false,
    };
  }

  return host[AUTH_STATE_KEY];
};

const getDb = (): D1Database | null => env.SCENARIOFORGE_DB ?? null;

const ensureSessionTable = async (db: D1Database): Promise<void> => {
  const state = getAuthState();

  if (state.tableReady) {
    return;
  }

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

  state.tableReady = true;
};

const sessionStore = defineSessionStore<AuthSession, AuthSession>({
  cookieName: "sf_auth_session",
  get: async (sessionId: string) => {
    await hydrateCoreStateFromD1();

    const db = getDb();

    if (db) {
      await ensureSessionTable(db);
      const row = await db
        .prepare(
          `
          SELECT principal_id, created_at, updated_at
          FROM sf_auth_sessions
          WHERE session_id = ?
        `,
        )
        .bind(sessionId)
        .first<Record<string, unknown>>();

      if (row) {
        const session: AuthSession = {
          principalId: String(row.principal_id),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        };
        getAuthState().sessions.set(sessionId, session);
        return session;
      }
    }

    const session = getAuthState().sessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found.");
    }

    return session;
  },
  set: async (sessionId: string, sessionInputData: AuthSession) => {
    const session: AuthSession = {
      ...sessionInputData,
      updatedAt: nowIso(),
    };

    getAuthState().sessions.set(sessionId, session);

    const db = getDb();
    if (!db) {
      return;
    }

    await ensureSessionTable(db);
    await db
      .prepare(
        `
        INSERT INTO sf_auth_sessions (session_id, principal_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          principal_id = excluded.principal_id,
          updated_at = excluded.updated_at
      `,
      )
      .bind(
        sessionId,
        session.principalId,
        session.createdAt,
        session.updatedAt,
      )
      .run();

    const principal = getPrincipalById(session.principalId);
    if (principal) {
      await persistPrincipalToD1(principal);
    }
  },
  unset: async (sessionId: string) => {
    getAuthState().sessions.delete(sessionId);

    const db = getDb();
    if (!db) {
      return;
    }

    await ensureSessionTable(db);
    await db
      .prepare(
        `
        DELETE FROM sf_auth_sessions
        WHERE session_id = ?
      `,
      )
      .bind(sessionId)
      .run();
  },
});

export const createAuthSession = (principalId: string): AuthSession => {
  const timestamp = nowIso();

  return {
    principalId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const loadAuthSession = async (
  request: Request,
): Promise<AuthSession | null> => {
  try {
    return await sessionStore.load(request);
  } catch {
    return null;
  }
};

export const saveAuthSession = async (
  responseHeaders: Headers,
  session: AuthSession,
): Promise<void> => {
  await sessionStore.save(responseHeaders, session, { maxAge: true });
};

export const clearAuthSession = async (
  request: Request,
  responseHeaders: Headers,
): Promise<void> => {
  await sessionStore.remove(request, responseHeaders);
};
