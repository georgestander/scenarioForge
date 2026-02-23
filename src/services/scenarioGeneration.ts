import type {
  Project,
  ScenarioContract,
  ScenarioPack,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";

const SCENARIO_BLUEPRINTS: Array<
  Omit<ScenarioContract, "id"> & { slug: string }
> = [
  {
    slug: "auth-connect-repo",
    feature: "Workspace Onboarding",
    outcome: "User establishes a valid workspace context",
    title: "Sign in, connect GitHub, and initialize project workspace",
    persona: "Solo builder",
    preconditions: ["User is signed out", "GitHub app is not yet connected"],
    testData: ["Display name", "Optional email", "GitHub installation callback"],
    steps: [
      "Sign in with ChatGPT credentials.",
      "Connect GitHub App and return via callback.",
      "Create project from repository metadata.",
    ],
    expectedCheckpoints: [
      "Principal session is persisted.",
      "Repository list is available for selection.",
      "Project is stored with default branch.",
    ],
    edgeVariants: [
      "GitHub callback has expired state token.",
      "Project created without repo selection.",
    ],
    passCriteria:
      "All three setup steps complete without API auth or ownership errors.",
    priority: "critical",
  },
  {
    slug: "source-trust-gate",
    feature: "Source Relevance Gate",
    outcome: "User curates trusted context before generation",
    title: "Scan source inventory and confirm relevance selection",
    persona: "QA lead",
    preconditions: [
      "Project exists",
      "Source scan endpoint returns mixed trusted/suspect/stale records",
    ],
    testData: ["Source IDs", "Confirmation note"],
    steps: [
      "Trigger scan and review trust statuses.",
      "Deselect stale sources.",
      "Confirm relevance and save source manifest.",
    ],
    expectedCheckpoints: [
      "Statuses and warnings appear for each source.",
      "Manifest hash is persisted with selected sources.",
      "Stale selections require explicit confirmation.",
    ],
    edgeVariants: [
      "No sources selected.",
      "User includes stale sources without confirmation.",
    ],
    passCriteria:
      "Generation remains blocked until at least one source is selected and relevance is confirmed.",
    priority: "critical",
  },
  {
    slug: "scenario-pack-by-feature",
    feature: "Scenario Generation",
    outcome: "User receives grouped scenario packs",
    title: "Generate feature-grouped scenario pack from selected sources",
    persona: "Product engineer",
    preconditions: ["Valid source manifest exists"],
    testData: ["Manifest ID", "Selected source IDs"],
    steps: [
      "Submit generation request for active project.",
      "Review generated scenarios grouped by feature.",
      "Inspect per-scenario contract fields.",
    ],
    expectedCheckpoints: [
      "Each scenario has preconditions, steps, checkpoints, edge variants, and pass criteria.",
      "Feature groups map to scenario IDs.",
      "Scenario markdown output is available.",
    ],
    edgeVariants: [
      "Manifest ID is missing.",
      "Manifest references excluded sources.",
    ],
    passCriteria:
      "Generated pack includes contract-complete scenarios and grouping metadata.",
    priority: "high",
  },
  {
    slug: "scenario-pack-by-outcome",
    feature: "Scenario Generation",
    outcome: "User can reason by outcome clusters",
    title: "Generate outcome-grouped scenario perspective for review",
    persona: "PM reviewer",
    preconditions: ["At least one scenario pack exists"],
    testData: ["Outcome group map"],
    steps: [
      "Open latest generated scenario pack.",
      "Switch grouping view from feature to outcome.",
      "Review scenario coverage per outcome.",
    ],
    expectedCheckpoints: [
      "Outcome grouping map contains all scenario IDs.",
      "No orphan scenarios are missing from both groupings.",
      "Outcome labels are human-readable.",
    ],
    edgeVariants: ["Single-feature project with multiple outcomes."],
    passCriteria:
      "Outcome grouping remains complete and consistent with scenario list.",
    priority: "medium",
  },
  {
    slug: "run-orchestration",
    feature: "Run Engine",
    outcome: "User executes and observes scenario progress",
    title: "Run all scenarios with queued/running/final statuses",
    persona: "Test operator",
    preconditions: ["Scenario pack exists"],
    testData: ["Scenario IDs selected for run"],
    steps: [
      "Start run for selected scenarios.",
      "Watch status transitions from queued to running to final status.",
      "Inspect run summary totals.",
    ],
    expectedCheckpoints: [
      "Run record is created with deterministic timeline.",
      "Summary totals match per-scenario outcomes.",
      "Completed run has immutable evidence payloads.",
    ],
    edgeVariants: [
      "Run started with subset of scenarios.",
      "Scenario is marked blocked due missing precondition.",
    ],
    passCriteria:
      "Run transitions are persisted and summary totals remain internally consistent.",
    priority: "critical",
  },
  {
    slug: "failure-evidence",
    feature: "Run Engine",
    outcome: "Failure records are actionable",
    title: "Capture observed-vs-expected and evidence on failure",
    persona: "Debugging engineer",
    preconditions: ["At least one scenario fails"],
    testData: ["Log refs", "Trace refs", "Screenshot refs"],
    steps: [
      "Open failed scenario details.",
      "Review observed versus expected mismatch.",
      "Read generated failure hypothesis.",
    ],
    expectedCheckpoints: [
      "Failure has artifacts for logs/traces/screenshots.",
      "Hypothesis references probable root cause domain.",
      "Evidence is linked to run and scenario IDs.",
    ],
    edgeVariants: [
      "Scenario fails without screenshot artifact.",
      "Multiple failures in same feature cluster.",
    ],
    passCriteria:
      "Every failed scenario exposes enough evidence to plan a fix.",
    priority: "high",
  },
  {
    slug: "auto-fix-pipeline",
    feature: "Auto-Fix",
    outcome: "User gets targeted fixes for failed scenarios",
    title: "Trigger auto-fix and generate fix attempt artifact",
    persona: "Maintainer",
    preconditions: ["Failed scenarios exist in latest run"],
    testData: ["Failed scenario IDs"],
    steps: [
      "Trigger auto-fix on failed scenarios.",
      "Inspect patch summary and impacted files.",
      "Confirm rerun summary is attached.",
    ],
    expectedCheckpoints: [
      "Fix attempt captures probable root cause.",
      "Patch summary maps to failed scenario IDs.",
      "Status advances to validated once rerun is recorded.",
    ],
    edgeVariants: ["No failed scenarios available for fix."],
    passCriteria:
      "Auto-fix records are traceable to specific failed scenarios and rerun evidence.",
    priority: "critical",
  },
  {
    slug: "pr-creation-gate",
    feature: "PR Pipeline",
    outcome: "PR includes scenario linkage and rerun proof",
    title: "Create PR record only after rerun evidence is available",
    persona: "Code reviewer",
    preconditions: ["Validated fix attempt exists"],
    testData: ["Fix attempt ID", "Rerun stats"],
    steps: [
      "Create PR record from fix attempt.",
      "Inspect branch naming and scenario linkage.",
      "Review residual risks before merge.",
    ],
    expectedCheckpoints: [
      "PR contains scenario IDs and root-cause summary.",
      "Rerun evidence stats are attached.",
      "PR status is open only when rerun failed count is zero.",
    ],
    edgeVariants: [
      "Rerun still contains failures.",
      "Fix attempt rerun data missing.",
    ],
    passCriteria:
      "PR artifact enforces rerun gate and provides reviewer-ready context.",
    priority: "critical",
  },
  {
    slug: "review-board",
    feature: "Review Board",
    outcome: "User gets consolidated risk and recommendation view",
    title: "Generate review board with run/fix/PR analytics",
    persona: "Tech lead",
    preconditions: ["At least one run exists"],
    testData: ["Run summaries", "PR statuses", "Failure counts"],
    steps: [
      "Open review board for project.",
      "Check risk map and recommendation ordering.",
      "Validate PR statuses against run outcomes.",
    ],
    expectedCheckpoints: [
      "Coverage and pass-rate metrics are populated.",
      "Risk map references failed or blocked scenarios.",
      "Recommendations prioritize unresolved risk.",
    ],
    edgeVariants: ["No PRs yet despite failures."],
    passCriteria:
      "Review board reflects persisted evidence and supports release decisions.",
    priority: "high",
  },
  {
    slug: "challenge-report",
    feature: "Reporting",
    outcome: "User exports challenge-ready narrative",
    title: "Export report summarizing source trust, runs, fixes, and PR outcomes",
    persona: "Challenge submitter",
    preconditions: ["Review board can be generated"],
    testData: ["Project metadata", "Manifest hash", "Run/PR aggregates"],
    steps: [
      "Trigger report export.",
      "Review markdown summary sections.",
      "Share report with stakeholders.",
    ],
    expectedCheckpoints: [
      "Report includes source manifest traceability.",
      "Run/failure/fix/PR evidence summaries are present.",
      "Recommendations and residual risks are explicit.",
    ],
    edgeVariants: ["No failures occurred in latest run."],
    passCriteria:
      "Report is readable, complete, and traceable to stored records.",
    priority: "medium",
  },
];

const scenarioId = (packSeed: string, index: number): string =>
  `${packSeed}_scn_${String(index + 1).padStart(2, "0")}`;

const renderScenarioMarkdown = (scenarios: ScenarioContract[]): string => {
  const lines: string[] = ["# Generated Scenarios", ""];

  scenarios.forEach((scenario) => {
    lines.push(`## ${scenario.id} - ${scenario.title}`);
    lines.push(`- Persona: ${scenario.persona}`);
    lines.push(`- Feature: ${scenario.feature}`);
    lines.push(`- Outcome: ${scenario.outcome}`);
    lines.push(`- Priority: ${scenario.priority}`);
    lines.push(`- Pass Criteria: ${scenario.passCriteria}`);
    lines.push("- Preconditions:");
    scenario.preconditions.forEach((item) => lines.push(`  - ${item}`));
    lines.push("- Steps:");
    scenario.steps.forEach((item) => lines.push(`  - ${item}`));
    lines.push("- Expected Checkpoints:");
    scenario.expectedCheckpoints.forEach((item) => lines.push(`  - ${item}`));
    lines.push("- Edge Variants:");
    scenario.edgeVariants.forEach((item) => lines.push(`  - ${item}`));
    lines.push("");
  });

  return lines.join("\n");
};

export const generateScenarioPack = (
  project: Project,
  ownerId: string,
  manifest: SourceManifest,
  selectedSources: SourceRecord[],
): Omit<ScenarioPack, "id" | "createdAt" | "updatedAt"> => {
  const packSeed = manifest.manifestHash.slice(0, 10);
  const sourceWeight = Math.max(1, Math.ceil(selectedSources.length / 3));
  const scenarioCount = Math.min(
    SCENARIO_BLUEPRINTS.length,
    Math.max(8, sourceWeight + 7),
  );

  const selectedBlueprints = SCENARIO_BLUEPRINTS.slice(0, scenarioCount);
  const scenarios: ScenarioContract[] = selectedBlueprints.map((blueprint, index) => ({
    id: scenarioId(packSeed, index),
    feature: blueprint.feature,
    outcome: blueprint.outcome,
    title: blueprint.title,
    persona: blueprint.persona,
    preconditions: blueprint.preconditions,
    testData: blueprint.testData,
    steps: blueprint.steps,
    expectedCheckpoints: blueprint.expectedCheckpoints,
    edgeVariants: blueprint.edgeVariants,
    passCriteria: blueprint.passCriteria,
    priority: blueprint.priority,
  }));

  const groupedByFeature: Record<string, string[]> = {};
  const groupedByOutcome: Record<string, string[]> = {};

  scenarios.forEach((scenario) => {
    groupedByFeature[scenario.feature] = groupedByFeature[scenario.feature] ?? [];
    groupedByFeature[scenario.feature].push(scenario.id);

    groupedByOutcome[scenario.outcome] = groupedByOutcome[scenario.outcome] ?? [];
    groupedByOutcome[scenario.outcome].push(scenario.id);
  });

  return {
    ownerId,
    projectId: project.id,
    manifestId: manifest.id,
    manifestHash: manifest.manifestHash,
    sourceIds: selectedSources.map((source) => source.id),
    model: "codex spark",
    groupedByFeature,
    groupedByOutcome,
    scenarios,
    scenariosMarkdown: renderScenarioMarkdown(scenarios),
  };
};
