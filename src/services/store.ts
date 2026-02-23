import type { CodexSession, Project } from "@/domain/models";

const STATE_KEY = "__SCENARIOFORGE_PHASE0_STATE__";

interface AppState {
  projects: Project[];
  sessions: CodexSession[];
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
    };
  }

  return host[STATE_KEY];
};

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

interface CreateProjectInput {
  name: string;
  repoUrl?: string | null;
  defaultBranch?: string;
}

export const listProjects = (): Project[] => {
  const state = getState();
  return [...state.projects].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
};

export const getProjectById = (projectId: string): Project | null => {
  const state = getState();
  return state.projects.find((project) => project.id === projectId) ?? null;
};

export const createProject = (input: CreateProjectInput): Project => {
  const state = getState();
  const timestamp = nowIso();

  const project: Project = {
    id: newId("proj"),
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

export const listCodexSessions = (): CodexSession[] => {
  const state = getState();
  return [...state.sessions].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
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

  state.sessions.push(session);
  return session;
};
