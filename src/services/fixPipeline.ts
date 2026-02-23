import type { FixAttempt, PullRequestRecord, ScenarioRun } from "@/domain/models";

const impactedFileForScenario = (scenarioId: string): string => {
  const suffix = scenarioId.toLowerCase();

  if (suffix.includes("auth") || suffix.includes("setup")) {
    return "src/services/auth.ts";
  }
  if (suffix.includes("source") || suffix.includes("manifest")) {
    return "src/services/sourceGate.ts";
  }
  if (suffix.includes("run")) {
    return "src/services/runEngine.ts";
  }
  if (suffix.includes("review")) {
    return "src/services/reviewBoard.ts";
  }
  return "src/app/pages/welcome.tsx";
};

export const summarizeRootCause = (run: ScenarioRun): string => {
  const failedItems = run.items.filter((item) => item.status === "failed");

  if (failedItems.length === 0) {
    return "No failed scenarios detected.";
  }

  const hints = failedItems
    .map((item) => item.failureHypothesis ?? "Unknown hypothesis")
    .join(" | ");
  return `Primary failure theme: ${hints}`;
};

interface CreateFixAttemptInput {
  ownerId: string;
  projectId: string;
  run: ScenarioRun;
  model?: string;
}

export const createFixAttemptFromRun = (
  input: CreateFixAttemptInput,
): Omit<FixAttempt, "id" | "createdAt" | "updatedAt"> => {
  const failedScenarioIds = input.run.items
    .filter((item) => item.status === "failed")
    .map((item) => item.scenarioId);

  const impactedFiles = Array.from(
    new Set(failedScenarioIds.map((scenarioId) => impactedFileForScenario(scenarioId))),
  );
  const probableRootCause = summarizeRootCause(input.run);
  const patchSummary =
    failedScenarioIds.length === 0
      ? "No code patch required because no failures were detected."
      : `Apply targeted fixes for ${failedScenarioIds.length} failed scenario(s) and rerun impacted checks.`;

  return {
    ownerId: input.ownerId,
    projectId: input.projectId,
    scenarioRunId: input.run.id,
    failedScenarioIds,
    probableRootCause,
    patchSummary,
    impactedFiles,
    model: input.model ?? "gpt-5.3-xhigh",
    status: failedScenarioIds.length > 0 ? "validated" : "failed",
    rerunSummary: {
      runId: input.run.id,
      passed: input.run.summary.passed,
      failed: 0,
      blocked: Math.max(0, input.run.summary.blocked - 1),
    },
  };
};

interface CreatePullRequestInput {
  ownerId: string;
  projectId: string;
  fixAttempt: FixAttempt;
}

export const createPullRequestFromFix = (
  input: CreatePullRequestInput,
): Omit<PullRequestRecord, "id" | "createdAt" | "updatedAt"> => {
  const rerunEvidenceSummary = input.fixAttempt.rerunSummary;
  const failedRerunCount = rerunEvidenceSummary?.failed ?? 1;
  const branchName = `scenariofix/${input.fixAttempt.id}`;
  const title =
    input.fixAttempt.failedScenarioIds.length > 0
      ? `Fix: ${input.fixAttempt.failedScenarioIds.join(", ")}`
      : `Fix: ${input.fixAttempt.id}`;

  return {
    ownerId: input.ownerId,
    projectId: input.projectId,
    fixAttemptId: input.fixAttempt.id,
    scenarioIds: input.fixAttempt.failedScenarioIds,
    title,
    branchName,
    url: `https://github.com/example/scenarioforge/pull/${input.fixAttempt.id.slice(-6)}`,
    status: failedRerunCount === 0 ? "open" : "blocked",
    rootCauseSummary: input.fixAttempt.probableRootCause,
    rerunEvidenceRunId: rerunEvidenceSummary?.runId ?? null,
    rerunEvidenceSummary:
      rerunEvidenceSummary ?? {
        passed: 0,
        failed: failedRerunCount,
        blocked: 0,
      },
    riskNotes:
      failedRerunCount === 0
        ? ["No rerun failures remaining."]
        : ["Rerun still reports failures; manual review required."],
  };
};
