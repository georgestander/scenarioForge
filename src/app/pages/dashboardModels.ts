export type DashboardLatestRunOutcome =
  | "idle"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked";

export interface DashboardProjectSummary {
  id: string;
  name: string;
  repoUrl: string | null;
  defaultBranch: string;
  openHref: string;
  runCount: number;
  latestRunOutcome: DashboardLatestRunOutcome;
  lastActivityAt: string;
  lastActivityLabel: string;
}

export interface DashboardRepoGroup {
  repoKey: string;
  repoLabel: string;
  repoUrl: string | null;
  projectCount: number;
  runCount: number;
  projects: DashboardProjectSummary[];
}

export interface DashboardActiveRunSummary {
  jobId: string;
  projectId: string;
  projectName: string;
  repoUrl: string | null;
  branch: string;
  executionMode: "run" | "fix" | "pr" | "full";
  status:
    | "queued"
    | "running"
    | "pausing"
    | "paused"
    | "stopping"
    | "cancelled"
    | "completed"
    | "failed"
    | "blocked";
  startedAt: string | null;
  updatedAt: string;
}

export interface DashboardTelemetrySummary {
  totalEvents: number;
  eventCounts: {
    readiness_checked: number;
    full_mode_blocked: number;
    execute_mode_selected: number;
    full_mode_started: number;
    full_mode_completed: number;
    manual_handoff_emitted: number;
  };
  topBlockerCodes: Array<{
    reasonCode: string;
    count: number;
  }>;
  actuatorCounts: Array<{
    actuatorPath: string;
    count: number;
  }>;
}
