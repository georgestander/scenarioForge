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
  status: "queued" | "running" | "completed" | "failed" | "blocked";
  startedAt: string | null;
  updatedAt: string;
}
