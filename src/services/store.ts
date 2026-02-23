import type {
  AuthPrincipal,
  AuthProvider,
  CodexSession,
  GitHubConnection,
  Project,
} from "@/domain/models";

const STATE_KEY = "__SCENARIOFORGE_PHASE0_STATE__";

interface AppState {
  projects: Project[];
  sessions: CodexSession[];
  principals: AuthPrincipal[];
  githubConnections: GitHubConnection[];
}

const nowIso = () => new Date().toISOString();

const getState = (): AppState => {
  const host = globalThis as typeof globalThis & {
    [STATE_KEY]?: AppState;
  };

  if (!host[STATE_KEY]) {
    host[STATE_KEY] = {
      projects: [],
      sessions: [],
      principals: [],
      githubConnections: [],
    };
  }

  return host[STATE_KEY];
};

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

interface CreateProjectInput {
  ownerId: string;
  name: string;
  repoUrl?: string | null;
  defaultBranch?: string;
}

export const listProjectsForOwner = (ownerId: string): Project[] => {
  const state = getState();
  return state.projects
    .filter((project) => project.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const getProjectByIdForOwner = (
  projectId: string,
  ownerId: string,
): Project | null => {
  const state = getState();
  return (
    state.projects.find(
      (project) => project.id === projectId && project.ownerId === ownerId,
    ) ?? null
  );
};

export const createProject = (input: CreateProjectInput): Project => {
  const state = getState();
  const timestamp = nowIso();

  const project: Project = {
    id: newId("proj"),
    ownerId: input.ownerId,
    name: input.name,
    repoUrl: input.repoUrl ?? null,
    defaultBranch: input.defaultBranch || "main",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.projects.push(project);
  return project;
};

export const listCodexSessionsForOwner = (ownerId: string): CodexSession[] => {
  const state = getState();
  return state.sessions
    .filter((session) => session.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const createCodexSession = (
  input: Omit<CodexSession, "id" | "createdAt" | "updatedAt">,
): CodexSession => {
  const state = getState();
  const timestamp = nowIso();

  const session: CodexSession = {
    ...input,
    id: newId("cxs"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.sessions.push(session);
  return session;
};

interface CreatePrincipalInput {
  provider: AuthProvider;
  displayName: string;
  email?: string | null;
}

export const createPrincipal = (input: CreatePrincipalInput): AuthPrincipal => {
  const state = getState();
  const timestamp = nowIso();
  const normalizedEmail = input.email?.trim().toLowerCase() || null;

  if (normalizedEmail) {
    const existing = state.principals.find(
      (principal) =>
        principal.provider === input.provider &&
        principal.email === normalizedEmail,
    );

    if (existing) {
      existing.displayName = input.displayName;
      existing.updatedAt = timestamp;
      return existing;
    }
  }

  const principal: AuthPrincipal = {
    id: newId("usr"),
    provider: input.provider,
    displayName: input.displayName,
    email: normalizedEmail,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.principals.push(principal);
  return principal;
};

export const getPrincipalById = (principalId: string): AuthPrincipal | null => {
  const state = getState();
  return state.principals.find((principal) => principal.id === principalId) ?? null;
};

interface UpsertGitHubConnectionInput {
  principalId: string;
  accountLogin: string | null;
  installationId: number;
  accessToken: string;
  accessTokenExpiresAt: string | null;
  repositories: GitHubConnection["repositories"];
}

export const upsertGitHubConnection = (
  input: UpsertGitHubConnectionInput,
): GitHubConnection => {
  const state = getState();
  const timestamp = nowIso();

  const existing = state.githubConnections.find(
    (connection) => connection.principalId === input.principalId,
  );

  if (existing) {
    existing.provider = "github_app";
    existing.status = "connected";
    existing.accountLogin = input.accountLogin;
    existing.installationId = input.installationId;
    existing.accessToken = input.accessToken;
    existing.accessTokenExpiresAt = input.accessTokenExpiresAt;
    existing.repositories = input.repositories;
    existing.updatedAt = timestamp;
    return existing;
  }

  const connection: GitHubConnection = {
    id: newId("ghc"),
    principalId: input.principalId,
    provider: "github_app",
    status: "connected",
    accountLogin: input.accountLogin,
    installationId: input.installationId,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    repositories: input.repositories,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.githubConnections.push(connection);
  return connection;
};

export const getGitHubConnectionForPrincipal = (
  principalId: string,
): GitHubConnection | null => {
  const state = getState();
  return (
    state.githubConnections.find(
      (connection) =>
        connection.principalId === principalId &&
        connection.status === "connected",
    ) ?? null
  );
};

export const disconnectGitHubConnectionForPrincipal = (
  principalId: string,
): void => {
  const state = getState();
  const existing = state.githubConnections.find(
    (connection) => connection.principalId === principalId,
  );

  if (!existing) {
    return;
  }

  existing.status = "disconnected";
  existing.accessToken = "";
  existing.accessTokenExpiresAt = null;
  existing.repositories = [];
  existing.updatedAt = nowIso();
};
