import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import type { ScenarioRun } from "@/domain/models";
import { redirect } from "@/app/shared/api";
import { listProjectsForOwner, listScenarioRunsForProject } from "@/services/store";
import { DashboardClient } from "./DashboardClient";
import type {
  DashboardLatestRunOutcome,
  DashboardProjectSummary,
  DashboardRepoGroup,
} from "./dashboardModels";

type AppRequestInfo = RequestInfo<any, AppContext>;

const formatUtcTimestamp = (isoTimestamp: string): string => {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) {
    return isoTimestamp;
  }

  const normalized = new Date(parsed).toISOString();
  return `${normalized.slice(0, 10)} ${normalized.slice(11, 16)} UTC`;
};

const parseRepoIdentity = (
  repoUrl: string | null,
): { key: string; label: string; url: string | null } => {
  if (!repoUrl) {
    return {
      key: "repo_unconfigured",
      label: "Unconfigured Repository",
      url: null,
    };
  }

  try {
    const parsed = new URL(repoUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname
      .replace(/^\/+/g, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/g, "");
    const segments = path.split("/").filter(Boolean);

    if ((host === "github.com" || host === "www.github.com") && segments.length >= 2) {
      const fullName = `${segments[0]}/${segments[1]}`;
      return {
        key: `github:${fullName.toLowerCase()}`,
        label: fullName,
        url: `https://github.com/${fullName}`,
      };
    }

    const label = path ? `${parsed.hostname}/${path}` : parsed.hostname;
    return {
      key: `url:${repoUrl.trim().toLowerCase()}`,
      label,
      url: repoUrl,
    };
  } catch {
    return {
      key: `text:${repoUrl.trim().toLowerCase()}`,
      label: repoUrl,
      url: repoUrl,
    };
  }
};

const deriveLatestRunOutcome = (run: ScenarioRun): DashboardLatestRunOutcome => {
  if (run.status === "queued" || run.status === "running") {
    return run.status;
  }

  if (run.summary.failed > 0) {
    return "failed";
  }

  if (run.summary.blocked > 0) {
    return "blocked";
  }

  return "passed";
};

const buildDashboardGroups = (ownerId: string): DashboardRepoGroup[] => {
  const projects = listProjectsForOwner(ownerId);
  const projectSummaries: DashboardProjectSummary[] = projects.map((project) => {
    const runs = listScenarioRunsForProject(ownerId, project.id);
    const latestRun = runs[0] ?? null;
    const lastActivityAt =
      latestRun?.completedAt ??
      latestRun?.updatedAt ??
      latestRun?.startedAt ??
      project.updatedAt;

    return {
      id: project.id,
      name: project.name,
      repoUrl: project.repoUrl,
      defaultBranch: project.defaultBranch,
      runCount: runs.length,
      latestRunOutcome: latestRun ? deriveLatestRunOutcome(latestRun) : "idle",
      lastActivityAt,
      lastActivityLabel:
        runs.length > 0 ? formatUtcTimestamp(lastActivityAt) : "Not run yet",
    };
  });

  const groupedByRepo = new Map<
    string,
    {
      repoLabel: string;
      repoUrl: string | null;
      runCount: number;
      latestActivityAt: string;
      projects: DashboardProjectSummary[];
    }
  >();

  for (const summary of projectSummaries) {
    const repo = parseRepoIdentity(summary.repoUrl);
    const existing = groupedByRepo.get(repo.key);

    if (!existing) {
      groupedByRepo.set(repo.key, {
        repoLabel: repo.label,
        repoUrl: repo.url,
        runCount: summary.runCount,
        latestActivityAt: summary.lastActivityAt,
        projects: [summary],
      });
      continue;
    }

    existing.runCount += summary.runCount;
    existing.projects.push(summary);
    if (summary.lastActivityAt > existing.latestActivityAt) {
      existing.latestActivityAt = summary.lastActivityAt;
    }
  }

  const groups: DashboardRepoGroup[] = Array.from(groupedByRepo.entries())
    .map(([repoKey, value]) => ({
      repoKey,
      repoLabel: value.repoLabel,
      repoUrl: value.repoUrl,
      projectCount: value.projects.length,
      runCount: value.runCount,
      projects: [...value.projects].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
      latestActivityAt: value.latestActivityAt,
    }))
    .sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt))
    .map(({ latestActivityAt: _latestActivityAt, ...group }) => group);

  return groups;
};

export const DashboardPage = ({ ctx }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const repoGroups = buildDashboardGroups(principal.id);

  return <DashboardClient initialRepoGroups={repoGroups} />;
};
