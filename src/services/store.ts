import type {
  AuthPrincipal,
  AuthProvider,
  CodeBaseline,
  CodexSession,
  ExecutionJob,
  ExecutionJobEvent,
  FixAttempt,
  GitHubConnection,
  ProjectPrReadiness,
  Project,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
  TelemetryEvent,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import { isSelectableSourceRecord } from "@/services/sourceSelection";

const STATE_KEY = "__SCENARIOFORGE_APP_STATE__";
const DEFAULT_IMPLEMENTATION_MODEL = "gpt-5.3-xhigh";

interface AppState {
  projects: Project[];
  sessions: CodexSession[];
  principals: AuthPrincipal[];
  githubConnections: GitHubConnection[];
  sources: SourceRecord[];
  sourceManifests: SourceManifest[];
  codeBaselines: CodeBaseline[];
  scenarioPacks: ScenarioPack[];
  scenarioRuns: ScenarioRun[];
  executionJobs: ExecutionJob[];
  executionJobEvents: ExecutionJobEvent[];
  fixAttempts: FixAttempt[];
  pullRequests: PullRequestRecord[];
  projectPrReadinessChecks: ProjectPrReadiness[];
  telemetryEvents: TelemetryEvent[];
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
      codeBaselines: [],
      scenarioPacks: [],
      scenarioRuns: [],
      executionJobs: [],
      executionJobEvents: [],
      fixAttempts: [],
      pullRequests: [],
      projectPrReadinessChecks: [],
      telemetryEvents: [],
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
    activeManifestId: null,
    activeScenarioPackId: null,
    activeScenarioRunId: null,
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

  if (!normalizedEmail) {
    const normalizedDisplayName = input.displayName.trim().toLowerCase();
    const existing = state.principals.find(
      (principal) =>
        principal.provider === input.provider &&
        principal.email === null &&
        principal.displayName.trim().toLowerCase() === normalizedDisplayName,
    );

    if (existing) {
      existing.displayName = input.displayName;
      existing.updatedAt = timestamp;
      return existing;
    }
  }

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

export const listPrincipals = (): AuthPrincipal[] => {
  const state = getState();
  return [...state.principals];
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

export const getLatestGitHubConnectionForPrincipal = (
  principalId: string,
): GitHubConnection | null => {
  const state = getState();
  const matches = state.githubConnections.filter(
    (connection) => connection.principalId === principalId,
  );

  if (matches.length === 0) {
    return null;
  }

  return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
};

export const disconnectGitHubConnectionForPrincipal = (
  principalId: string,
): GitHubConnection | null => {
  const state = getState();
  const existing = state.githubConnections.find(
    (connection) => connection.principalId === principalId,
  );

  if (!existing) {
    return null;
  }

  existing.status = "disconnected";
  existing.accessToken = "";
  existing.accessTokenExpiresAt = null;
  existing.repositories = [];
  existing.updatedAt = nowIso();
  return existing;
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

  const selectableCandidates = input.sources.filter((candidate) =>
    isSelectableSourceRecord(candidate),
  );

  const nextRecords: SourceRecord[] = selectableCandidates.map((candidate) => {
    const match = existing.find((source) => source.path === candidate.path);

    if (match) {
      match.repositoryFullName = candidate.repositoryFullName;
      match.branch = candidate.branch;
      match.headCommitSha = candidate.headCommitSha;
      match.lastCommitSha = candidate.lastCommitSha;
      match.title = candidate.title;
      match.type = candidate.type;
      match.lastModifiedAt = candidate.lastModifiedAt;
      match.alignmentScore = candidate.alignmentScore;
      match.isConflicting = candidate.isConflicting;
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
      (source) =>
        source.ownerId === ownerId &&
        source.projectId === projectId &&
        isSelectableSourceRecord(source),
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

    if (!isSelectableSourceRecord(source)) {
      source.selected = false;
      source.status = "excluded";
      source.updatedAt = timestamp;
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
  repositoryFullName: string;
  branch: string;
  headCommitSha: string;
  sourceIds: string[];
  sourcePaths: string[];
  sourceHashes: string[];
  statusCounts: SourceManifest["statusCounts"];
  includesStale: boolean;
  includesConflicts: boolean;
  userConfirmed: boolean;
  confirmationNote: string;
  confirmedAt: string | null;
  codeBaselineId: string;
  codeBaselineHash: string;
  codeBaselineGeneratedAt: string;
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
    repositoryFullName: input.repositoryFullName,
    branch: input.branch,
    headCommitSha: input.headCommitSha,
    sourceIds: input.sourceIds,
    sourcePaths: input.sourcePaths,
    sourceHashes: input.sourceHashes,
    statusCounts: input.statusCounts,
    includesStale: input.includesStale,
    includesConflicts: input.includesConflicts,
    userConfirmed: input.userConfirmed,
    confirmationNote: input.confirmationNote,
    confirmedAt: input.confirmedAt,
    codeBaselineId: input.codeBaselineId,
    codeBaselineHash: input.codeBaselineHash,
    codeBaselineGeneratedAt: input.codeBaselineGeneratedAt,
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

export const upsertProjectCodeBaseline = (
  input: Omit<CodeBaseline, "id" | "createdAt" | "updatedAt">,
): CodeBaseline => {
  const state = getState();
  const timestamp = nowIso();
  const existing = state.codeBaselines.find(
    (record) =>
      record.ownerId === input.ownerId &&
      record.projectId === input.projectId &&
      record.repositoryFullName === input.repositoryFullName &&
      record.branch === input.branch,
  );

  if (existing) {
    existing.headCommitSha = input.headCommitSha;
    existing.generatedAt = input.generatedAt;
    existing.baselineHash = input.baselineHash;
    existing.routeMap = [...input.routeMap];
    existing.apiSurface = [...input.apiSurface];
    existing.stateTransitions = [...input.stateTransitions];
    existing.asyncBoundaries = [...input.asyncBoundaries];
    existing.domainEntities = [...input.domainEntities];
    existing.integrations = [...input.integrations];
    existing.errorPaths = [...input.errorPaths];
    existing.likelyFailurePoints = [...input.likelyFailurePoints];
    existing.evidenceAnchors = [...input.evidenceAnchors];
    existing.updatedAt = timestamp;
    return existing;
  }

  const record: CodeBaseline = {
    ...input,
    id: newId("cb"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.codeBaselines.push(record);
  return record;
};

export const listCodeBaselinesForProject = (
  ownerId: string,
  projectId: string,
): CodeBaseline[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.codeBaselines.filter(
      (record) => record.ownerId === ownerId && record.projectId === projectId,
    ),
  );
};

export const getLatestCodeBaselineForProject = (
  ownerId: string,
  projectId: string,
): CodeBaseline | null => {
  const baselines = listCodeBaselinesForProject(ownerId, projectId);
  return baselines[0] ?? null;
};

export const getCodeBaselineById = (
  ownerId: string,
  codeBaselineId: string,
): CodeBaseline | null => {
  const state = getState();
  return (
    state.codeBaselines.find(
      (record) => record.ownerId === ownerId && record.id === codeBaselineId,
    ) ?? null
  );
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

export const createExecutionJob = (
  input: Omit<ExecutionJob, "id" | "createdAt" | "updatedAt">,
): ExecutionJob => {
  const state = getState();
  const timestamp = nowIso();

  const job: ExecutionJob = {
    ...input,
    id: newId("job"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.executionJobs.push(job);
  return job;
};

export const updateExecutionJob = (
  ownerId: string,
  jobId: string,
  updater: (job: ExecutionJob) => void,
): ExecutionJob | null => {
  const state = getState();
  const job = state.executionJobs.find(
    (record) => record.id === jobId && record.ownerId === ownerId,
  );

  if (!job) {
    return null;
  }

  updater(job);
  job.updatedAt = nowIso();
  return job;
};

export const listExecutionJobsForOwner = (ownerId: string): ExecutionJob[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.executionJobs.filter((job) => job.ownerId === ownerId),
  );
};

export const listExecutionJobsForProject = (
  ownerId: string,
  projectId: string,
): ExecutionJob[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.executionJobs.filter(
      (job) => job.ownerId === ownerId && job.projectId === projectId,
    ),
  );
};

const isExecutionJobActive = (status: ExecutionJob["status"]): boolean =>
  status === "queued" ||
  status === "running" ||
  status === "pausing" ||
  status === "paused" ||
  status === "stopping";

export const listActiveExecutionJobsForOwner = (
  ownerId: string,
): ExecutionJob[] =>
  listExecutionJobsForOwner(ownerId).filter((job) =>
    isExecutionJobActive(job.status),
  );

export const listActiveExecutionJobsForProject = (
  ownerId: string,
  projectId: string,
): ExecutionJob[] =>
  listExecutionJobsForProject(ownerId, projectId).filter((job) =>
    isExecutionJobActive(job.status),
  );

export const getExecutionJobById = (
  ownerId: string,
  jobId: string,
): ExecutionJob | null => {
  const state = getState();
  return (
    state.executionJobs.find((job) => job.ownerId === ownerId && job.id === jobId) ??
    null
  );
};

export const createExecutionJobEvent = (
  input: Omit<ExecutionJobEvent, "id" | "sequence" | "createdAt">,
): ExecutionJobEvent => {
  const state = getState();
  const timestamp = nowIso();
  const existingEvents = state.executionJobEvents.filter(
    (event) =>
      event.ownerId === input.ownerId &&
      event.projectId === input.projectId &&
      event.jobId === input.jobId,
  );
  const lastSequence = existingEvents.reduce(
    (max, item) => Math.max(max, item.sequence),
    0,
  );

  const event: ExecutionJobEvent = {
    ...input,
    id: newId("jev"),
    sequence: lastSequence + 1,
    createdAt: timestamp,
  };

  state.executionJobEvents.push(event);
  return event;
};

export const listExecutionJobEvents = (
  ownerId: string,
  jobId: string,
  afterSequence = 0,
  limit = 200,
): ExecutionJobEvent[] => {
  const state = getState();
  return state.executionJobEvents
    .filter(
      (event) =>
        event.ownerId === ownerId &&
        event.jobId === jobId &&
        event.sequence > afterSequence,
    )
    .sort((a, b) => a.sequence - b.sequence)
    .slice(0, Math.max(1, limit));
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

export const getPullRequestById = (
  ownerId: string,
  pullRequestId: string,
): PullRequestRecord | null => {
  const state = getState();
  return (
    state.pullRequests.find(
      (record) => record.ownerId === ownerId && record.id === pullRequestId,
    ) ?? null
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

export interface ProjectExecutionHistoryDeleteResult {
  scenarioRuns: number;
  executionJobs: number;
  executionJobEvents: number;
  fixAttempts: number;
  pullRequests: number;
  telemetryEvents: number;
}

export const deleteProjectExecutionHistory = (
  ownerId: string,
  projectId: string,
): ProjectExecutionHistoryDeleteResult => {
  const state = getState();

  const scenarioRuns = state.scenarioRuns.filter(
    (record) => record.ownerId === ownerId && record.projectId === projectId,
  ).length;
  const executionJobs = state.executionJobs.filter(
    (record) => record.ownerId === ownerId && record.projectId === projectId,
  ).length;
  const executionJobEvents = state.executionJobEvents.filter(
    (record) => record.ownerId === ownerId && record.projectId === projectId,
  ).length;
  const fixAttempts = state.fixAttempts.filter(
    (record) => record.ownerId === ownerId && record.projectId === projectId,
  ).length;
  const pullRequests = state.pullRequests.filter(
    (record) => record.ownerId === ownerId && record.projectId === projectId,
  ).length;
  const telemetryEvents = state.telemetryEvents.filter(
    (record) => record.ownerId === ownerId && record.projectId === projectId,
  ).length;

  state.scenarioRuns = state.scenarioRuns.filter(
    (record) => !(record.ownerId === ownerId && record.projectId === projectId),
  );
  state.executionJobs = state.executionJobs.filter(
    (record) => !(record.ownerId === ownerId && record.projectId === projectId),
  );
  state.executionJobEvents = state.executionJobEvents.filter(
    (record) => !(record.ownerId === ownerId && record.projectId === projectId),
  );
  state.fixAttempts = state.fixAttempts.filter(
    (record) => !(record.ownerId === ownerId && record.projectId === projectId),
  );
  state.pullRequests = state.pullRequests.filter(
    (record) => !(record.ownerId === ownerId && record.projectId === projectId),
  );
  state.telemetryEvents = state.telemetryEvents.filter(
    (record) => !(record.ownerId === ownerId && record.projectId === projectId),
  );

  return {
    scenarioRuns,
    executionJobs,
    executionJobEvents,
    fixAttempts,
    pullRequests,
    telemetryEvents,
  };
};

export const upsertProjectPrReadinessCheck = (
  input: Omit<ProjectPrReadiness, "id" | "createdAt" | "updatedAt">,
): ProjectPrReadiness => {
  const state = getState();
  const timestamp = nowIso();
  const existing = state.projectPrReadinessChecks.find(
    (record) =>
      record.ownerId === input.ownerId &&
      record.projectId === input.projectId,
  );

  if (existing) {
    existing.repositoryFullName = input.repositoryFullName;
    existing.branch = input.branch;
    existing.status = input.status;
    existing.fullPrActuator = input.fullPrActuator;
    existing.capabilities = input.capabilities;
    existing.reasonCodes = [...input.reasonCodes];
    existing.reasons = [...input.reasons];
    existing.recommendedActions = [...input.recommendedActions];
    existing.probeResults = [...input.probeResults];
    existing.probeDurationMs = input.probeDurationMs;
    existing.checkedAt = input.checkedAt;
    existing.updatedAt = timestamp;
    return existing;
  }

  const readiness: ProjectPrReadiness = {
    ...input,
    id: newId("ready"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.projectPrReadinessChecks.push(readiness);
  return readiness;
};

export const listProjectPrReadinessChecksForProject = (
  ownerId: string,
  projectId: string,
): ProjectPrReadiness[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.projectPrReadinessChecks.filter(
      (record) =>
        record.ownerId === ownerId &&
        record.projectId === projectId,
    ),
  );
};

export const getLatestProjectPrReadinessForProject = (
  ownerId: string,
  projectId: string,
): ProjectPrReadiness | null => {
  const records = listProjectPrReadinessChecksForProject(ownerId, projectId);
  return records[0] ?? null;
};

export const createTelemetryEvent = (
  input: Omit<TelemetryEvent, "id" | "createdAt" | "updatedAt">,
): TelemetryEvent => {
  const state = getState();
  const timestamp = nowIso();
  const event: TelemetryEvent = {
    ...input,
    payload: { ...input.payload },
    reasonCodes: [...input.reasonCodes],
    id: newId("tel"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.telemetryEvents.push(event);
  return event;
};

export const listTelemetryEventsForOwner = (
  ownerId: string,
  limit = 500,
): TelemetryEvent[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.telemetryEvents.filter((event) => event.ownerId === ownerId),
  ).slice(0, Math.max(0, limit));
};

export const listTelemetryEventsForProject = (
  ownerId: string,
  projectId: string,
): TelemetryEvent[] => {
  const state = getState();
  return sortByUpdatedDesc(
    state.telemetryEvents.filter(
      (event) => event.ownerId === ownerId && event.projectId === projectId,
    ),
  );
};

const replaceById = <T extends { id: string }>(
  items: T[],
  nextItem: T,
): T[] => {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index === -1) {
    items.push(nextItem);
    return items;
  }

  items[index] = nextItem;
  return items;
};

export const upsertPrincipalRecord = (principal: AuthPrincipal): void => {
  const state = getState();
  replaceById(state.principals, principal);
};

export const upsertProjectRecord = (project: Project): void => {
  const state = getState();
  replaceById(state.projects, project);
};

export const upsertCodexSessionRecord = (session: CodexSession): void => {
  const state = getState();
  replaceById(state.sessions, normalizeSessionModel(session));
};

interface HydrateCoreStateInput {
  principals: AuthPrincipal[];
  projects: Project[];
  sessions: CodexSession[];
  githubConnections?: GitHubConnection[];
  sources?: SourceRecord[];
  sourceManifests?: SourceManifest[];
  codeBaselines?: CodeBaseline[];
  scenarioPacks?: ScenarioPack[];
  scenarioRuns?: ScenarioRun[];
  executionJobs?: ExecutionJob[];
  executionJobEvents?: ExecutionJobEvent[];
  fixAttempts?: FixAttempt[];
  pullRequests?: PullRequestRecord[];
  projectPrReadinessChecks?: ProjectPrReadiness[];
  telemetryEvents?: TelemetryEvent[];
  mode?: "merge" | "replacePersisted";
}

export const hydrateCoreState = (input: HydrateCoreStateInput): void => {
  const state = getState();

  if (input.mode === "replacePersisted") {
    state.principals = [...input.principals];
    state.projects = [...input.projects];
    state.sessions = input.sessions.map((session) =>
      normalizeSessionModel({ ...session }),
    );
    state.githubConnections = [...(input.githubConnections ?? [])];
    state.sources = [...(input.sources ?? [])];
    state.sourceManifests = [...(input.sourceManifests ?? [])];
    state.codeBaselines = [...(input.codeBaselines ?? [])];
    state.scenarioPacks = [...(input.scenarioPacks ?? [])];
    state.scenarioRuns = [...(input.scenarioRuns ?? [])];
    state.executionJobs = [...(input.executionJobs ?? [])];
    state.executionJobEvents = [...(input.executionJobEvents ?? [])];
    state.fixAttempts = [...(input.fixAttempts ?? [])];
    state.pullRequests = [...(input.pullRequests ?? [])];
    state.projectPrReadinessChecks = [...(input.projectPrReadinessChecks ?? [])];
    state.telemetryEvents = [...(input.telemetryEvents ?? [])];
    return;
  }

  input.principals.forEach((principal) => {
    upsertPrincipalRecord(principal);
  });

  input.projects.forEach((project) => {
    upsertProjectRecord(project);
  });

  input.sessions.forEach((session) => {
    upsertCodexSessionRecord(session);
  });

  (input.githubConnections ?? []).forEach((connection) => {
    const existingIndex = state.githubConnections.findIndex(
      (candidate) =>
        candidate.id === connection.id ||
        candidate.principalId === connection.principalId,
    );

    if (existingIndex === -1) {
      state.githubConnections.push(connection);
      return;
    }

    state.githubConnections[existingIndex] = connection;
  });

  (input.sources ?? []).forEach((source) => {
    replaceById(state.sources, source);
  });

  (input.sourceManifests ?? []).forEach((manifest) => {
    replaceById(state.sourceManifests, manifest);
  });

  (input.codeBaselines ?? []).forEach((baseline) => {
    replaceById(state.codeBaselines, baseline);
  });

  (input.scenarioPacks ?? []).forEach((pack) => {
    replaceById(state.scenarioPacks, pack);
  });

  (input.scenarioRuns ?? []).forEach((run) => {
    replaceById(state.scenarioRuns, run);
  });

  (input.executionJobs ?? []).forEach((job) => {
    replaceById(state.executionJobs, job);
  });

  (input.executionJobEvents ?? []).forEach((event) => {
    replaceById(state.executionJobEvents, event);
  });

  (input.fixAttempts ?? []).forEach((attempt) => {
    replaceById(state.fixAttempts, attempt);
  });

  (input.pullRequests ?? []).forEach((record) => {
    replaceById(state.pullRequests, record);
  });

  (input.projectPrReadinessChecks ?? []).forEach((readiness) => {
    replaceById(state.projectPrReadinessChecks, readiness);
  });

  (input.telemetryEvents ?? []).forEach((event) => {
    replaceById(state.telemetryEvents, event);
  });
};
