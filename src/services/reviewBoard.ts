import type {
  Project,
  PullRequestRecord,
  ReviewBoard,
  ScenarioPack,
  ScenarioRun,
  SourceManifest,
} from "@/domain/models";

const passRate = (run: ScenarioRun | null): number => {
  if (!run || run.summary.total === 0) {
    return 0;
  }
  return Number(((run.summary.passed / run.summary.total) * 100).toFixed(1));
};

export const buildReviewBoard = (
  project: Project,
  scenarioPacks: ScenarioPack[],
  runs: ScenarioRun[],
  pullRequests: PullRequestRecord[],
): ReviewBoard => {
  const latestRun = runs[0] ?? null;
  const latestPack = scenarioPacks[0] ?? null;
  const failures =
    latestRun?.items.filter((item) => item.status === "failed" || item.status === "blocked") ??
    [];

  const recommendations: ReviewBoard["recommendations"] = [];

  if (failures.length > 0) {
    recommendations.push({
      id: `rec_${project.id}_fix`,
      priority: "high",
      title: "Prioritize unresolved failed scenarios",
      detail:
        "Resolve failed and blocked scenarios before shipping; rerun impacted flows after each fix.",
      scenarioIds: failures.map((item) => item.scenarioId),
    });
  }

  if ((latestPack?.coverage.uncoveredGaps.length ?? 0) > 0) {
    recommendations.push({
      id: `rec_${project.id}_coverage`,
      priority: "high",
      title: "Resolve uncovered required coverage gaps",
      detail:
        "Review coverage gaps surfaced during generation and close them before running execute loop.",
      scenarioIds: latestPack?.scenarios.map((scenario) => scenario.id) ?? [],
    });
  }

  if (pullRequests.some((record) => record.status === "blocked")) {
    recommendations.push({
      id: `rec_${project.id}_pr`,
      priority: "medium",
      title: "Unblock PRs with rerun verification",
      detail:
        "At least one PR is blocked by missing rerun evidence. Re-run and attach proof before review.",
      scenarioIds: pullRequests.flatMap((record) => record.scenarioIds),
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: `rec_${project.id}_steady`,
      priority: "low",
      title: "Expand scenario depth",
      detail:
        "Current run is stable. Add more edge-case variants to raise confidence before release.",
      scenarioIds: latestPack?.scenarios.map((scenario) => scenario.id) ?? [],
    });
  }

  return {
    id: `rvw_${project.id}`,
    projectId: project.id,
    ownerId: project.ownerId,
    generatedAt: new Date().toISOString(),
    coverage: {
      totalScenarios: latestPack?.scenarios.length ?? 0,
      latestRunId: latestRun?.id ?? null,
      passRate: passRate(latestRun),
    },
    runSummary: {
      runs: runs.length,
      failures: runs.reduce((count, run) => count + run.summary.failed, 0),
      blocked: runs.reduce((count, run) => count + run.summary.blocked, 0),
    },
    pullRequests: pullRequests.map((record) => ({
      id: record.id,
      title: record.title,
      status: record.status,
      url: record.url,
      scenarioIds: record.scenarioIds,
    })),
    risks: [
      ...failures.map((item) => ({
        scenarioId: item.scenarioId,
        severity: item.status === "failed" ? ("high" as const) : ("medium" as const),
        reason:
          item.failureHypothesis ??
          "Scenario did not pass and requires investigation before merge.",
      })),
      ...((latestPack?.coverage.uncoveredGaps ?? []).map((gap) => ({
        scenarioId: "COVERAGE",
        severity: "high" as const,
        reason: `Uncovered gap: ${gap}`,
      })) ?? []),
    ],
    recommendations,
  };
};

export const buildChallengeReport = (
  project: Project,
  manifest: SourceManifest | null,
  board: ReviewBoard,
  latestRun: ScenarioRun | null,
  pullRequests: PullRequestRecord[] = [],
): string => {
  const lines: string[] = [];

  lines.push(`# ScenarioForge Challenge Report`);
  lines.push("");
  lines.push(`- Project: ${project.name}`);
  lines.push(`- Project ID: ${project.id}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Default branch: ${project.defaultBranch}`);
  lines.push("");

  lines.push("## Source Trust Gate");
  if (!manifest) {
    lines.push("- No manifest found.");
  } else {
    lines.push(`- Manifest ID: ${manifest.id}`);
    lines.push(`- Manifest hash: ${manifest.manifestHash}`);
    lines.push(`- Selected sources: ${manifest.sourceIds.length}`);
    lines.push(`- Includes stale sources: ${manifest.includesStale ? "yes" : "no"}`);
    lines.push(`- User confirmed relevance: ${manifest.userConfirmed ? "yes" : "no"}`);
    if (manifest.confirmationNote) {
      lines.push(`- Confirmation note: ${manifest.confirmationNote}`);
    }
  }
  lines.push("");

  lines.push("## Scenario Run Summary");
  if (!latestRun) {
    lines.push("- No runs recorded.");
  } else {
    lines.push(`- Latest run: ${latestRun.id}`);
    lines.push(`- Total: ${latestRun.summary.total}`);
    lines.push(`- Passed: ${latestRun.summary.passed}`);
    lines.push(`- Failed: ${latestRun.summary.failed}`);
    lines.push(`- Blocked: ${latestRun.summary.blocked}`);
  }
  lines.push("");

  lines.push("## Pull Requests");
  if (pullRequests.length === 0) {
    lines.push("- No pull requests recorded.");
  } else {
    pullRequests.forEach((pullRequest) => {
      lines.push(
        pullRequest.url
          ? `- [${pullRequest.title}](${pullRequest.url})`
          : `- ${pullRequest.title} (manual handoff required)`,
      );
      lines.push(`  - Status: ${pullRequest.status}`);
      lines.push(`  - Branch: ${pullRequest.branchName}`);
      lines.push(
        `  - Scenarios: ${
          pullRequest.scenarioIds.length > 0
            ? pullRequest.scenarioIds.join(", ")
            : "none"
        }`,
      );
      lines.push(`  - Root cause: ${pullRequest.rootCauseSummary}`);
      if (pullRequest.riskNotes.length > 0) {
        lines.push(`  - Risk notes: ${pullRequest.riskNotes.join(" | ")}`);
      }
    });
  }
  lines.push("");

  lines.push("## Scenario Checks");
  if (!latestRun || latestRun.items.length === 0) {
    lines.push("- No scenario checks captured.");
  } else {
    const pullRequestsByScenarioId = pullRequests.reduce(
      (acc, pullRequest) => {
        for (const scenarioId of pullRequest.scenarioIds) {
          const existing = acc.get(scenarioId) ?? [];
          existing.push(pullRequest);
          acc.set(scenarioId, existing);
        }
        return acc;
      },
      new Map<string, PullRequestRecord[]>(),
    );

    latestRun.items.forEach((item) => {
      lines.push(`### ${item.scenarioId} — ${item.status}`);
      lines.push(`- Expected: ${item.expected}`);
      lines.push(`- Observed: ${item.observed}`);
      if (item.failureHypothesis) {
        lines.push(`- Failure hypothesis: ${item.failureHypothesis}`);
      }
      if (item.artifacts.length > 0) {
        lines.push("- Artifacts:");
        item.artifacts.forEach((artifact) => {
          lines.push(`  - [${artifact.label}](${artifact.value}) (${artifact.kind})`);
        });
      }
      const scenarioPullRequests = pullRequestsByScenarioId.get(item.scenarioId) ?? [];
      if (scenarioPullRequests.length > 0) {
        lines.push("- Related PRs:");
        scenarioPullRequests.forEach((pullRequest) => {
          lines.push(
            pullRequest.url
              ? `  - [${pullRequest.title}](${pullRequest.url}) (${pullRequest.status})`
              : `  - ${pullRequest.title} (${pullRequest.status}, branch: ${pullRequest.branchName})`,
          );
        });
      }
      lines.push("");
    });
  }

  lines.push("## Review Board");
  lines.push(`- Coverage pass rate: ${board.coverage.passRate}%`);
  lines.push(`- Pull requests tracked: ${board.pullRequests.length}`);
  lines.push(`- Risks tracked: ${board.risks.length}`);
  lines.push("");

  lines.push("## Recommendations");
  board.recommendations.forEach((recommendation) => {
    lines.push(`- [${recommendation.priority}] ${recommendation.title}: ${recommendation.detail}`);
  });

  return lines.join("\n");
};
