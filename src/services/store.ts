import type {
  AuthPrincipal,
  AuthProvider,
  CodexSession,
  FixAttempt,
  GitHubConnection,
  Project,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";

const STATE_KEY = "__SCENARIOFORGE_APP_STATE__";
const DEFAULT_IMPLEMENTATION_MODEL = "gpt-5.3-xhigh";

interface AppState {
  projects: Project[];
  sessions: CodexSession[];
  principals: AuthPrincipal[];
  githubConnections: GitHubConnection[];
  sources: SourceRecord[];
  sourceManifests: SourceManifest[];
  scenarioPacks: ScenarioPack[];
  scenarioRuns: ScenarioRun[];
  fixAttempts: FixAttempt[];
  pullRequests: PullRequestRecord[];
}

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

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
      sources: [],
      sourceManifests: [],
      scenarioPacks: [],
      scenarioRuns: [],
      fixAttempts: [],
      pullRequests: [],
    };
  }

  return host[STATE_KEY];
};

const sortByUpdatedDesc = <T extends { updatedAt: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const normalizeSessionModel = (session: CodexSession): CodexSession => {
  session.threadStartRequest = {
    ...session.threadStartRequest,
    params: {
      ...session.threadStartRequest.params,
      model: DEFAULT_IMPLEMENTATION_MODEL,
    },
  };

  session.preferredModels = {
    ...session.preferredModels,
    implementation: DEFAULT_IMPLEMENTATION_MODEL,
  };

  return session;
};

interface CreateProjectInput {
  ownerId: string;
  name: string;
  repoUrl?: string | null;
  defaultBranch?: string;
}

export const listProjectsForOwner = (ownerId: string): Project[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.projects.filter((project) => project.ownerId === ownerId),
  );
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
  return sortByUpdatedDesc(
    state.sessions
      .filter((session) => session.ownerId === ownerId)
      .map(normalizeSessionModel),
  );
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

  const normalized = normalizeSessionModel(session);
  state.sessions.push(normalized);
  return normalized;
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

interface UpsertProjectSourcesInput {
  ownerId: string;
  projectId: string;
  sources: Omit<SourceRecord, "id" | "createdAt" | "updatedAt">[];
}

export const upsertProjectSources = (
  input: UpsertProjectSourcesInput,
): SourceRecord[] => {
  const state = getState();
  const timestamp = nowIso();
  const existing = state.sources.filter(
    (source) =>
      source.ownerId === input.ownerId && source.projectId === input.projectId,
  );

  const nextRecords: SourceRecord[] = input.sources.map((candidate) => {
    const match = existing.find((source) => source.path === candidate.path);

    if (match) {
      match.title = candidate.title;
      match.type = candidate.type;
      match.lastModifiedAt = candidate.lastModifiedAt;
      match.relevanceScore = candidate.relevanceScore;
      match.status = candidate.status;
      match.selected = candidate.selected;
      match.warnings = candidate.warnings;
      match.hash = candidate.hash;
      match.updatedAt = timestamp;
      return match;
    }

    return {
      ...candidate,
      id: newId("src"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  const nextIds = new Set(nextRecords.map((source) => source.id));
  state.sources = state.sources.filter((source) => {
    if (source.ownerId !== input.ownerId || source.projectId !== input.projectId) {
      return true;
    }
    return nextIds.has(source.id);
  });
  state.sources.push(...nextRecords);

  return nextRecords;
};

export const listSourcesForProject = (
  ownerId: string,
  projectId: string,
): SourceRecord[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.sources.filter(
      (source) => source.ownerId === ownerId && source.projectId === projectId,
    ),
  );
};

export const updateSourceSelections = (
  ownerId: string,
  projectId: string,
  sourceIds: string[],
): SourceRecord[] => {
  const state = getState();
  const selected = new Set(sourceIds);
  const timestamp = nowIso();

  state.sources.forEach((source) => {
    if (source.ownerId !== ownerId || source.projectId !== projectId) {
      return;
    }

    source.selected = selected.has(source.id);
    source.status = source.selected
      ? source.status === "excluded"
        ? "suspect"
        : source.status
      : "excluded";
    source.updatedAt = timestamp;
  });

  return listSourcesForProject(ownerId, projectId);
};

interface CreateSourceManifestInput {
  ownerId: string;
  projectId: string;
  sourceIds: string[];
  sourceHashes: string[];
  statusCounts: SourceManifest["statusCounts"];
  includesStale: boolean;
  userConfirmed: boolean;
  confirmationNote: string;
  confirmedAt: string | null;
  manifestHash: string;
}

export const createSourceManifest = (
  input: CreateSourceManifestInput,
): SourceManifest => {
  const state = getState();
  const timestamp = nowIso();

  const manifest: SourceManifest = {
    id: newId("smf"),
    ownerId: input.ownerId,
    projectId: input.projectId,
    sourceIds: input.sourceIds,
    sourceHashes: input.sourceHashes,
    statusCounts: input.statusCounts,
    includesStale: input.includesStale,
    userConfirmed: input.userConfirmed,
    confirmationNote: input.confirmationNote,
    confirmedAt: input.confirmedAt,
    manifestHash: input.manifestHash,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.sourceManifests.push(manifest);
  return manifest;
};

export const listSourceManifestsForProject = (
  ownerId: string,
  projectId: string,
): SourceManifest[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.sourceManifests.filter(
      (manifest) =>
        manifest.ownerId === ownerId && manifest.projectId === projectId,
    ),
  );
};

export const getSourceManifestById = (
  ownerId: string,
  manifestId: string,
): SourceManifest | null => {
  const state = getState();
  return (
    state.sourceManifests.find(
      (manifest) => manifest.ownerId === ownerId && manifest.id === manifestId,
    ) ?? null
  );
};

export const getLatestSourceManifestForProject = (
  ownerId: string,
  projectId: string,
): SourceManifest | null => {
  const manifests = listSourceManifestsForProject(ownerId, projectId);
  return manifests[0] ?? null;
};

export const createScenarioPack = (
  input: Omit<ScenarioPack, "id" | "createdAt" | "updatedAt">,
): ScenarioPack => {
  const state = getState();
  const timestamp = nowIso();

  const pack: ScenarioPack = {
    ...input,
    id: newId("spk"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.scenarioPacks.push(pack);
  return pack;
};

export const listScenarioPacksForProject = (
  ownerId: string,
  projectId: string,
): ScenarioPack[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.scenarioPacks.filter(
      (pack) => pack.ownerId === ownerId && pack.projectId === projectId,
    ),
  );
};

export const getScenarioPackById = (
  ownerId: string,
  packId: string,
): ScenarioPack | null => {
  const state = getState();
  return (
    state.scenarioPacks.find((pack) => pack.ownerId === ownerId && pack.id === packId) ??
    null
  );
};

export const createScenarioRun = (
  input: Omit<ScenarioRun, "id" | "createdAt" | "updatedAt">,
): ScenarioRun => {
  const state = getState();
  const timestamp = nowIso();

  const run: ScenarioRun = {
    ...input,
    id: newId("run"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.scenarioRuns.push(run);
  return run;
};

export const updateScenarioRun = (
  ownerId: string,
  runId: string,
  updater: (run: ScenarioRun) => void,
): ScenarioRun | null => {
  const state = getState();
  const run = state.scenarioRuns.find(
    (record) => record.id === runId && record.ownerId === ownerId,
  );

  if (!run) {
    return null;
  }

  updater(run);
  run.updatedAt = nowIso();
  return run;
};

export const listScenarioRunsForProject = (
  ownerId: string,
  projectId: string,
): ScenarioRun[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.scenarioRuns.filter(
      (run) => run.ownerId === ownerId && run.projectId === projectId,
    ),
  );
};

export const getScenarioRunById = (
  ownerId: string,
  runId: string,
): ScenarioRun | null => {
  const state = getState();
  return (
    state.scenarioRuns.find((run) => run.ownerId === ownerId && run.id === runId) ??
    null
  );
};

export const createFixAttempt = (
  input: Omit<FixAttempt, "id" | "createdAt" | "updatedAt">,
): FixAttempt => {
  const state = getState();
  const timestamp = nowIso();

  const attempt: FixAttempt = {
    ...input,
    id: newId("fix"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.fixAttempts.push(attempt);
  return attempt;
};

export const updateFixAttempt = (
  ownerId: string,
  fixAttemptId: string,
  updater: (attempt: FixAttempt) => void,
): FixAttempt | null => {
  const state = getState();
  const attempt = state.fixAttempts.find(
    (record) => record.id === fixAttemptId && record.ownerId === ownerId,
  );

  if (!attempt) {
    return null;
  }

  updater(attempt);
  attempt.updatedAt = nowIso();
  return attempt;
};

export const listFixAttemptsForProject = (
  ownerId: string,
  projectId: string,
): FixAttempt[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.fixAttempts.filter(
      (attempt) => attempt.ownerId === ownerId && attempt.projectId === projectId,
    ),
  );
};

export const getFixAttemptById = (
  ownerId: string,
  fixAttemptId: string,
): FixAttempt | null => {
  const state = getState();
  return (
    state.fixAttempts.find(
      (attempt) => attempt.ownerId === ownerId && attempt.id === fixAttemptId,
    ) ?? null
  );
};

export const createPullRequestRecord = (
  input: Omit<PullRequestRecord, "id" | "createdAt" | "updatedAt">,
): PullRequestRecord => {
  const state = getState();
  const timestamp = nowIso();

  const record: PullRequestRecord = {
    ...input,
    id: newId("pr"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.pullRequests.push(record);
  return record;
};

export const listPullRequestsForProject = (
  ownerId: string,
  projectId: string,
): PullRequestRecord[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.pullRequests.filter(
      (record) => record.ownerId === ownerId && record.projectId === projectId,
    ),
  );
};

export const updatePullRequestRecord = (
  ownerId: string,
  pullRequestId: string,
  updater: (record: PullRequestRecord) => void,
): PullRequestRecord | null => {
  const state = getState();
  const record = state.pullRequests.find(
    (item) => item.id === pullRequestId && item.ownerId === ownerId,
  );

  if (!record) {
    return null;
  }

  updater(record);
  record.updatedAt = nowIso();
  return record;
};
