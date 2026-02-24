export type DashboardLatestRunOutcome =
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
