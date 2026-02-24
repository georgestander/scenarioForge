import type {
  AuthPrincipal,
  CodeBaseline,
  FixAttempt,
  GitHubRepository,
  ProjectPrReadiness,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";

export interface CollectionPayload<T> {
  data: T[];
}

export interface AuthSessionPayload {
  authenticated: boolean;
  principal: AuthPrincipal | null;
}

export interface ChatGptSignInStartPayload {
  loginId: string;
  authUrl: string;
}

export interface ChatGptSignInCompletePayload {
  authenticated: boolean;
  principal: AuthPrincipal | null;
  pending?: boolean;
}

export interface ChatGptSignInStatusPayload {
  completed: {
    loginId: string | null;
    success: boolean;
    error: string | null;
    receivedAt: string;
  } | null;
}

export interface GitHubConnectionView {
  id: string;
  principalId: string;
  provider: "github_app";
  status: "connected" | "disconnected";
  accountLogin: string | null;
  installationId: number;
  accessTokenExpiresAt: string | null;
  repositories: GitHubRepository[];
  createdAt: string;
  updatedAt: string;
}

export interface GitHubConnectionPayload {
  connection: GitHubConnectionView | null;
}

export interface GitHubInstallPayload {
  alreadyConnected?: boolean;
  installUrl?: string;
  manageUrl?: string;
}

export interface GitHubConnectPayload {
  repositories: GitHubRepository[];
}

export interface ManifestCreatePayload {
  manifest: SourceManifest;
  selectedSources: SourceRecord[];
  includesStale: boolean;
  includesConflicts: boolean;
  codeBaseline: CodeBaseline | null;
}

export interface SourcesScanPayload {
  data: SourceRecord[];
  codeBaseline: CodeBaseline | null;
}

export interface ScenarioActionGeneratePayload {
  pack: ScenarioPack;
  mode: "initial" | "update";
  userInstruction: string | null;
}

export interface ScenarioActionExecutePayload {
  run: ScenarioRun;
  fixAttempt: FixAttempt | null;
  pullRequests: PullRequestRecord[];
  executionMode: "run" | "fix" | "pr" | "full";
  executionAudit: {
    model: string;
    threadId: string;
    turnId: string;
    turnStatus: string;
    completedAt: string;
  };
}

export interface CodexStreamEventLog {
  id: string;
  action: "generate" | "execute";
  event: string;
  phase: string;
  message: string;
  timestamp: string;
  scenarioId?: string;
  stage?: string;
  status?: string;
}

export interface ReviewBoardPayload {
  board: import("@/domain/models").ReviewBoard;
}

export interface ReviewReportPayload {
  markdown: string;
}

export interface ProjectPrReadinessPayload {
  readiness: ProjectPrReadiness | null;
}

export interface GitHubSyncPayload {
  repositories: GitHubRepository[];
}

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type OpenInNewTabResult = "opened" | "blocked";

export interface ExecuteBoardRow {
  scenarioId: string;
  title: string;
  status: "queued" | "running" | "passed" | "failed" | "blocked";
  stage: "run" | "fix" | "rerun" | "pr";
  lastEvent: string;
  attempt: number;
  lastUpdated: string;
  artifactRefs: Array<{ kind: "log" | "screenshot" | "trace"; label: string }>;
  failureHypothesis: string | null;
}
