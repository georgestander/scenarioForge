import type {
  ScenarioContract,
  ScenarioEvidenceArtifact,
  ScenarioExecutionStatus,
  ScenarioPack,
  ScenarioRun,
  ScenarioRunEvent,
  ScenarioRunItem,
} from "@/domain/models";

const buildArtifacts = (
  runIdSeed: string,
  scenarioId: string,
): ScenarioEvidenceArtifact[] => [
  {
    kind: "log",
    label: "Execution log",
    value: `/artifacts/${runIdSeed}/${scenarioId}/run.log`,
  },
  {
    kind: "trace",
    label: "Trace bundle",
    value: `/artifacts/${runIdSeed}/${scenarioId}/trace.json`,
  },
  {
    kind: "screenshot",
    label: "Final UI snapshot",
    value: `/artifacts/${runIdSeed}/${scenarioId}/screen.png`,
  },
];

export const captureFailureEvidence = (
  runIdSeed: string,
  scenario: ScenarioContract,
): {
  observed: string;
  expected: string;
  failureHypothesis: string;
  artifacts: ScenarioEvidenceArtifact[];
} => {
  const expected = scenario.passCriteria;
  const observed = `Observed mismatch in "${scenario.feature}" validation checkpoints.`;

  return {
    observed,
    expected,
    failureHypothesis: `Likely drift between source assumptions and implementation path for ${scenario.feature.toLowerCase()}.`,
    artifacts: buildArtifacts(runIdSeed, scenario.id),
  };
};

const finalStatusForIndex = (
  index: number,
  totalCount: number,
): Exclude<ScenarioExecutionStatus, "queued" | "running"> => {
  if (index === totalCount - 1 && totalCount > 3) {
    return "blocked";
  }

  if (index % 3 === 1) {
    return "failed";
  }

  return "passed";
};

interface CreateRunInput {
  ownerId: string;
  projectId: string;
  pack: ScenarioPack;
  selectedScenarioIds?: string[];
}

export const createScenarioRunRecord = (
  input: CreateRunInput,
): Omit<ScenarioRun, "id" | "createdAt" | "updatedAt"> => {
  const selectedSet = new Set(
    input.selectedScenarioIds && input.selectedScenarioIds.length > 0
      ? input.selectedScenarioIds
      : input.pack.scenarios.map((scenario) => scenario.id),
  );
  const scenarios = input.pack.scenarios.filter((scenario) =>
    selectedSet.has(scenario.id),
  );

  const startedAtMs = Date.now();
  const runIdSeed = input.pack.manifestHash.slice(0, 8);
  const items: ScenarioRunItem[] = [];
  const events: ScenarioRunEvent[] = [];

  scenarios.forEach((scenario, index) => {
    const startedAt = new Date(startedAtMs + index * 1000).toISOString();
    const completedAt = new Date(startedAtMs + index * 1000 + 650).toISOString();
    const finalStatus = finalStatusForIndex(index, scenarios.length);

    events.push({
      id: `evt_${scenario.id}_queued`,
      scenarioId: scenario.id,
      status: "queued",
      message: `${scenario.id} queued`,
      timestamp: startedAt,
    });
    events.push({
      id: `evt_${scenario.id}_running`,
      scenarioId: scenario.id,
      status: "running",
      message: `${scenario.id} running`,
      timestamp: startedAt,
    });

    if (finalStatus === "failed") {
      const failure = captureFailureEvidence(runIdSeed, scenario);

      items.push({
        scenarioId: scenario.id,
        status: "failed",
        startedAt,
        completedAt,
        observed: failure.observed,
        expected: failure.expected,
        failureHypothesis: failure.failureHypothesis,
        artifacts: failure.artifacts,
      });
      events.push({
        id: `evt_${scenario.id}_failed`,
        scenarioId: scenario.id,
        status: "failed",
        message: `${scenario.id} failed`,
        timestamp: completedAt,
      });
      return;
    }

    if (finalStatus === "blocked") {
      items.push({
        scenarioId: scenario.id,
        status: "blocked",
        startedAt,
        completedAt,
        observed: "Execution blocked by unmet downstream dependency.",
        expected: scenario.passCriteria,
        failureHypothesis:
          "Dependency scenario failed earlier in run; rerun after fix.",
        artifacts: buildArtifacts(runIdSeed, scenario.id),
      });
      events.push({
        id: `evt_${scenario.id}_blocked`,
        scenarioId: scenario.id,
        status: "blocked",
        message: `${scenario.id} blocked`,
        timestamp: completedAt,
      });
      return;
    }

    items.push({
      scenarioId: scenario.id,
      status: "passed",
      startedAt,
      completedAt,
      observed: "Observed output matched expected checkpoints.",
      expected: scenario.passCriteria,
      failureHypothesis: null,
      artifacts: buildArtifacts(runIdSeed, scenario.id),
    });
    events.push({
      id: `evt_${scenario.id}_passed`,
      scenarioId: scenario.id,
      status: "passed",
      message: `${scenario.id} passed`,
      timestamp: completedAt,
    });
  });

  const summary = items.reduce(
    (acc, item) => {
      if (item.status === "passed") {
        acc.passed += 1;
      } else if (item.status === "failed") {
        acc.failed += 1;
      } else if (item.status === "blocked") {
        acc.blocked += 1;
      }
      return acc;
    },
    {
      total: items.length,
      passed: 0,
      failed: 0,
      blocked: 0,
    },
  );

  return {
    ownerId: input.ownerId,
    projectId: input.projectId,
    scenarioPackId: input.pack.id,
    status: "completed",
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(startedAtMs + scenarios.length * 1000).toISOString(),
    items,
    summary,
    events,
  };
};
