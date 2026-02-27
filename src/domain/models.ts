export type ProjectStatus = "draft" | "active";

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  repoUrl: string | null;
  defaultBranch: string;
  activeManifestId: string | null;
  activeScenarioPackId: string | null;
  activeScenarioRunId: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export type AuthProvider = "chatgpt";

export interface AuthPrincipal {
  id: string;
  provider: AuthProvider;
  displayName: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  principalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

export interface GitHubConnection {
  id: string;
  principalId: string;
  provider: "github_app";
  status: "connected" | "disconnected";
  accountLogin: string | null;
  installationId: number;
  accessToken: string;
  accessTokenExpiresAt: string | null;
  repositories: GitHubRepository[];
  createdAt: string;
  updatedAt: string;
}

export interface JsonRpcRequest {
  method: string;
  id: number;
  params: Record<string, unknown>;
}

export interface CodexSession {
  id: string;
  ownerId: string;
  projectId: string;
  status: "initialized" | "thread-ready";
  transport: "skeleton";
  createdAt: string;
  updatedAt: string;
  initializeRequest: JsonRpcRequest;
  threadStartRequest: JsonRpcRequest;
  preferredModels: {
    research: string;
    implementation: string;
  };
}

export type SourceType = "prd" | "spec" | "plan" | "architecture" | "code";
export type SourceRelevanceStatus = "trusted" | "suspect" | "stale" | "excluded";

export interface CodeBaseline {
  id: string;
  projectId: string;
  ownerId: string;
  repositoryFullName: string;
  branch: string;
  headCommitSha: string;
  generatedAt: string;
  baselineHash: string;
  routeMap: string[];
  apiSurface: string[];
  stateTransitions: string[];
  asyncBoundaries: string[];
  domainEntities: string[];
  integrations: string[];
  errorPaths: string[];
  likelyFailurePoints: string[];
  evidenceAnchors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SourceRecord {
  id: string;
  projectId: string;
  ownerId: string;
  repositoryFullName: string;
  branch: string;
  headCommitSha: string;
  lastCommitSha: string | null;
  path: string;
  title: string;
  type: SourceType;
  lastModifiedAt: string;
  alignmentScore: number;
  isConflicting: boolean;
  relevanceScore: number;
  status: SourceRelevanceStatus;
  selected: boolean;
  warnings: string[];
  hash: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceManifest {
  id: string;
  projectId: string;
  ownerId: string;
  repositoryFullName: string;
  branch: string;
  headCommitSha: string;
  sourceIds: string[];
  sourcePaths: string[];
  sourceHashes: string[];
  statusCounts: Record<SourceRelevanceStatus, number>;
  includesStale: boolean;
  includesConflicts: boolean;
  userConfirmed: boolean;
  confirmationNote: string;
  confirmedAt: string | null;
  codeBaselineId: string;
  codeBaselineHash: string;
  codeBaselineGeneratedAt: string;
  manifestHash: string;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioPriority = "critical" | "high" | "medium";

export interface ScenarioContract {
  id: string;
  feature: string;
  outcome: string;
  title: string;
  persona: string;
  journey?: string;
  riskIntent?: string;
  preconditions: string[];
  testData: string[];
  steps: string[];
  expectedCheckpoints: string[];
  edgeVariants: string[];
  codeEvidenceAnchors?: string[];
  sourceRefs?: string[];
  passCriteria: string;
  priority: ScenarioPriority;
}

export interface ScenarioCoverageSummary {
  personas: string[];
  journeys: string[];
  edgeBuckets: string[];
  features: string[];
  outcomes: string[];
  assumptions: string[];
  knownUnknowns: string[];
  uncoveredGaps: string[];
}

export interface ScenarioGenerationAudit {
  transport: "codex-app-server";
  requestedSkill: string;
  usedSkill: string | null;
  skillAvailable: boolean;
  skillPath: string | null;
  threadId: string;
  turnId: string;
  turnStatus: string;
  cwd: string;
  generatedAt: string;
}

export interface ScenarioPack {
  id: string;
  projectId: string;
  ownerId: string;
  manifestId: string;
  manifestHash: string;
  repositoryFullName: string;
  branch: string;
  headCommitSha: string;
  sourceIds: string[];
  model: string;
  generationAudit: ScenarioGenerationAudit;
  coverage: ScenarioCoverageSummary;
  groupedByFeature: Record<string, string[]>;
  groupedByOutcome: Record<string, string[]>;
  scenarios: ScenarioContract[];
  scenariosMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioExecutionStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked";

export interface ScenarioEvidenceArtifact {
  kind: "log" | "screenshot" | "trace";
  label: string;
  value: string;
}

export interface ScenarioRunItem {
  scenarioId: string;
  status: ScenarioExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  observed: string;
  expected: string;
  failureHypothesis: string | null;
  artifacts: ScenarioEvidenceArtifact[];
}

export interface ScenarioRunEvent {
  id: string;
  scenarioId: string;
  status: ScenarioExecutionStatus;
  message: string;
  timestamp: string;
}

export interface ScenarioRun {
  id: string;
  projectId: string;
  ownerId: string;
  scenarioPackId: string;
  status: "queued" | "running" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  items: ScenarioRunItem[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
  };
  events: ScenarioRunEvent[];
  createdAt: string;
  updatedAt: string;
}

export type ExecutionJobStatus =
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "stopping"
  | "cancelled"
  | "completed"
  | "failed"
  | "blocked";

export type ExecutionJobEventStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "complete";

export interface ExecutionJob {
  id: string;
  projectId: string;
  ownerId: string;
  scenarioPackId: string;
  executionMode: "run" | "fix" | "pr" | "full";
  status: ExecutionJobStatus;
  userInstruction: string | null;
  constraints: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  runId: string | null;
  fixAttemptId: string | null;
  pullRequestIds: string[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
  } | null;
  executionAudit: {
    model: string | null;
    threadId: string | null;
    turnId: string | null;
    turnStatus: string | null;
    completedAt: string | null;
  };
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionJobEvent {
  id: string;
  jobId: string;
  ownerId: string;
  projectId: string;
  sequence: number;
  event: string;
  phase: string;
  status: ExecutionJobEventStatus;
  message: string;
  scenarioId: string | null;
  stage: "run" | "fix" | "rerun" | "pr" | null;
  payload: unknown;
  timestamp: string;
  createdAt: string;
}

export type FixAttemptStatus = "planned" | "in_progress" | "validated" | "failed";

export interface FixAttempt {
  id: string;
  projectId: string;
  ownerId: string;
  scenarioRunId: string;
  failedScenarioIds: string[];
  probableRootCause: string;
  patchSummary: string;
  impactedFiles: string[];
  model: string;
  status: FixAttemptStatus;
  rerunSummary: {
    runId: string;
    passed: number;
    failed: number;
    blocked: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export type PullRequestStatus = "draft" | "open" | "merged" | "blocked";

export interface PullRequestRecord {
  id: string;
  projectId: string;
  ownerId: string;
  fixAttemptId: string;
  scenarioIds: string[];
  title: string;
  branchName: string;
  url: string;
  status: PullRequestStatus;
  rootCauseSummary: string;
  rerunEvidenceRunId: string | null;
  rerunEvidenceSummary: {
    passed: number;
    failed: number;
    blocked: number;
  } | null;
  riskNotes: string[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectPrReadinessStatus = "ready" | "needs_attention";
export type ProjectPrReadinessActuator =
  | "controller"
  | "codex_git_workspace"
  | "codex_connector"
  | "none";

export type ProjectPrReadinessReasonCode =
  | "CODEX_BRIDGE_UNREACHABLE"
  | "CODEX_ACCOUNT_NOT_AUTHENTICATED"
  | "GITHUB_CONNECTION_MISSING"
  | "GITHUB_REPO_NOT_CONFIGURED"
  | "GITHUB_REPO_READ_DENIED"
  | "GITHUB_BRANCH_NOT_FOUND"
  | "GITHUB_WRITE_PERMISSIONS_MISSING"
  | "SANDBOX_GIT_PROTECTED"
  | "TOOL_SIDE_EFFECT_APPROVALS_UNSUPPORTED"
  | "PR_ACTUATOR_UNAVAILABLE";

export type ProjectPrReadinessProbeStep =
  | "codex_bridge"
  | "codex_account"
  | "github_connection"
  | "repository_config"
  | "repository_access"
  | "branch_access"
  | "github_permissions"
  | "actuator_path";

export interface ProjectPrReadinessProbeResult {
  step: ProjectPrReadinessProbeStep;
  ok: boolean;
  reasonCode: ProjectPrReadinessReasonCode | null;
  message: string;
}

export interface ProjectPrReadiness {
  id: string;
  ownerId: string;
  projectId: string;
  repositoryFullName: string | null;
  branch: string;
  status: ProjectPrReadinessStatus;
  fullPrActuator: ProjectPrReadinessActuator;
  capabilities: {
    hasGitHubConnection: boolean;
    repositoryConfigured: boolean;
    repositoryAccessible: boolean;
    branchExists: boolean;
    canPush: boolean;
    canCreateBranch: boolean;
    canOpenPr: boolean;
    codexBridgeConfigured: boolean;
  };
  reasonCodes: ProjectPrReadinessReasonCode[];
  reasons: string[];
  recommendedActions: string[];
  probeResults: ProjectPrReadinessProbeResult[];
  probeDurationMs: number;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type TelemetryEventName =
  | "readiness_checked"
  | "full_mode_blocked"
  | "execute_mode_selected"
  | "full_mode_started"
  | "full_mode_completed"
  | "manual_handoff_emitted";

export interface TelemetryEvent {
  id: string;
  ownerId: string;
  projectId: string;
  jobId: string | null;
  eventName: TelemetryEventName;
  executionMode: "run" | "fix" | "pr" | "full" | null;
  actuatorPath: ProjectPrReadinessActuator | null;
  reasonCodes: ProjectPrReadinessReasonCode[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRiskItem {
  scenarioId: string;
  severity: "high" | "medium" | "low";
  reason: string;
}

export interface ReviewRecommendation {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  scenarioIds: string[];
}

export interface ReviewBoard {
  id: string;
  projectId: string;
  ownerId: string;
  generatedAt: string;
  coverage: {
    totalScenarios: number;
    latestRunId: string | null;
    passRate: number;
  };
  runSummary: {
    runs: number;
    failures: number;
    blocked: number;
  };
  pullRequests: Array<{
    id: string;
    title: string;
    status: PullRequestStatus;
    url: string;
    scenarioIds: string[];
  }>;
  risks: ReviewRiskItem[];
  recommendations: ReviewRecommendation[];
}
