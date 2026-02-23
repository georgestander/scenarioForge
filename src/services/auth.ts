import { defineSessionStore } from "rwsdk/auth";
import type { AuthSession } from "@/domain/models";

const AUTH_STATE_KEY = "__SCENARIOFORGE_AUTH_STATE__";

interface AuthState {
  sessions: Map<string, AuthSession>;
}

const nowIso = () => new Date().toISOString();

const getAuthState = (): AuthState => {
  const host = globalThis as typeof globalThis & {
    [AUTH_STATE_KEY]?: AuthState;
  };

  if (!host[AUTH_STATE_KEY]) {
    host[AUTH_STATE_KEY] = {
      sessions: new Map<string, AuthSession>(),
    };
  }

  return host[AUTH_STATE_KEY];
};

const sessionStore = defineSessionStore<AuthSession, AuthSession>({
  cookieName: "sf_auth_session",
  get: async (sessionId: string) => {
    const session = getAuthState().sessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found.");
    }

    return session;
  },
  set: async (sessionId: string, sessionInputData: AuthSession) => {
    getAuthState().sessions.set(sessionId, {
      ...sessionInputData,
      updatedAt: nowIso(),
    });
  },
  unset: async (sessionId: string) => {
    getAuthState().sessions.delete(sessionId);
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
