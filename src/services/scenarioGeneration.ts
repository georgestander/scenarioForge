import type {
  CodeBaseline,
  Project,
  ScenarioContract,
  ScenarioCoverageSummary,
  ScenarioPack,
  ScenarioPriority,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import { isCodeFirstGenerationEnabled } from "@/services/featureFlags";

const PRIORITIES: readonly ScenarioPriority[] = ["critical", "high", "medium"];

const nowIso = () => new Date().toISOString();

type JsonRecord = Record<string, unknown>;

export interface ScenarioGenerationMetadata {
  transport: "codex-app-server";
  requestedSkill: string;
  usedSkill: string | null;
  skillAvailable: boolean;
  skillPath: string | null;
  threadId: string;
  turnId: string;
  turnStatus: string;
  cwd: string;
  generatedAt?: string;
}

interface ParsedScenarioOutput {
  scenarios: ScenarioContract[];
  coverage: ScenarioCoverageSummary;
  groupedByFeature: Record<string, string[]>;
  groupedByOutcome: Record<string, string[]>;
}

interface GenerateScenarioPackInput {
  project: Project;
  ownerId: string;
  manifest: SourceManifest;
  selectedSources: SourceRecord[];
  codeBaseline?: CodeBaseline | null;
  model: string;
  rawOutput: unknown;
  metadata: ScenarioGenerationMetadata;
}

interface CoverageValidationResult {
  ok: boolean;
  errors: string[];
  requiredGapEntries: string[];
  knownUnknownEntries: string[];
}

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseRawOutput = (rawOutput: unknown): unknown => {
  if (typeof rawOutput !== "string") {
    return rawOutput;
  }

  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new Error("Codex scenario generation returned an empty response.");
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new Error("Codex scenario generation response was not valid JSON.");
  }
};

const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid scenario output: ${fieldName} must be a non-empty string.`);
  }
  return value.trim();
};

const optionalString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const requireStringArray = (value: unknown, fieldName: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid scenario output: ${fieldName} must be an array of strings.`);
  }

  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);

  if (normalized.length === 0) {
    throw new Error(`Invalid scenario output: ${fieldName} must include at least one entry.`);
  }

  return normalized;
};

const optionalStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
};

const normalizePriority = (value: unknown): ScenarioPriority => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (PRIORITIES.includes(normalized as ScenarioPriority)) {
    return normalized as ScenarioPriority;
  }

  throw new Error(
    `Invalid scenario output: priority must be one of ${PRIORITIES.join(", ")}.`,
  );
};

const normalizeScenario = (value: unknown, index: number): ScenarioContract => {
  if (!isRecord(value)) {
    throw new Error(`Invalid scenario output: scenario at index ${index} is not an object.`);
  }

  return {
    id: requireString(value.id, `scenarios[${index}].id`),
    feature: requireString(value.feature, `scenarios[${index}].feature`),
    outcome: requireString(value.outcome, `scenarios[${index}].outcome`),
    title: requireString(value.title, `scenarios[${index}].title`),
    persona: requireString(value.persona, `scenarios[${index}].persona`),
    journey:
      optionalString(value.journey) || requireString(value.title, `scenarios[${index}].title`),
    riskIntent: optionalString(value.riskIntent),
    preconditions: requireStringArray(
      value.preconditions,
      `scenarios[${index}].preconditions`,
    ),
    testData: requireStringArray(value.testData, `scenarios[${index}].testData`),
    steps: requireStringArray(value.steps, `scenarios[${index}].steps`),
    expectedCheckpoints: requireStringArray(
      value.expectedCheckpoints,
      `scenarios[${index}].expectedCheckpoints`,
    ),
    edgeVariants: requireStringArray(
      value.edgeVariants,
      `scenarios[${index}].edgeVariants`,
    ),
    codeEvidenceAnchors: optionalStringArray(value.codeEvidenceAnchors),
    sourceRefs: optionalStringArray(value.sourceRefs),
    passCriteria: requireString(value.passCriteria, `scenarios[${index}].passCriteria`),
    priority: normalizePriority(value.priority),
  };
};

const normalizeScenarios = (value: unknown): ScenarioContract[] => {
  if (!Array.isArray(value)) {
    throw new Error("Invalid scenario output: scenarios must be an array.");
  }

  const scenarios = value.map((scenario, index) => normalizeScenario(scenario, index));
  if (scenarios.length === 0) {
    throw new Error("Invalid scenario output: expected at least one scenario.");
  }

  const seenIds = new Set<string>();
  scenarios.forEach((scenario) => {
    if (seenIds.has(scenario.id)) {
      throw new Error(`Invalid scenario output: duplicate scenario id ${scenario.id}.`);
    }
    seenIds.add(scenario.id);
  });

  return scenarios;
};

const normalizeGroupMap = (
  value: unknown,
  mapName: string,
  groupKeyField: "feature" | "outcome",
): Record<string, string[]> => {
  const output: Record<string, string[]> = {};

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!isRecord(entry)) {
        return;
      }

      const groupKey =
        typeof entry[groupKeyField] === "string" ? entry[groupKeyField].trim() : "";
      const ids = Array.isArray(entry.scenarioIds) ? entry.scenarioIds : [];
      const normalizedIds = ids
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0);

      if (groupKey && normalizedIds.length > 0) {
        output[groupKey] = normalizedIds;
      }
    });
    return output;
  }

  if (!isRecord(value)) {
    return {};
  }

  Object.entries(value).forEach(([groupKey, ids]) => {
    if (!Array.isArray(ids)) {
      return;
    }

    const normalizedIds = ids
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);

    if (normalizedIds.length > 0) {
      output[groupKey] = normalizedIds;
    }
  });

  if (Object.keys(output).length > 0) {
    return output;
  }

  return {};
};

const deriveGroupsFromScenarios = (
  scenarios: ScenarioContract[],
): {
  byFeature: Record<string, string[]>;
  byOutcome: Record<string, string[]>;
} => {
  const byFeature: Record<string, string[]> = {};
  const byOutcome: Record<string, string[]> = {};

  scenarios.forEach((scenario) => {
    byFeature[scenario.feature] = byFeature[scenario.feature] ?? [];
    byFeature[scenario.feature].push(scenario.id);

    byOutcome[scenario.outcome] = byOutcome[scenario.outcome] ?? [];
    byOutcome[scenario.outcome].push(scenario.id);
  });

  return {
    byFeature,
    byOutcome,
  };
};

const normalizeLooseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
};

const buildDerivedCoverage = (
  scenarios: ScenarioContract[],
): ScenarioCoverageSummary => {
  const personas = new Set<string>();
  const journeys = new Set<string>();
  const edgeBuckets = new Set<string>();
  const features = new Set<string>();
  const outcomes = new Set<string>();

  scenarios.forEach((scenario) => {
    personas.add(scenario.persona);
    journeys.add(scenario.journey?.trim() || scenario.title);
    features.add(scenario.feature);
    outcomes.add(scenario.outcome);
    scenario.edgeVariants.forEach((variant) => edgeBuckets.add(variant));
  });

  return {
    personas: [...personas],
    journeys: [...journeys],
    edgeBuckets: [...edgeBuckets],
    features: [...features],
    outcomes: [...outcomes],
    assumptions: [],
    knownUnknowns: [],
    uncoveredGaps: [],
  };
};

const parseScenarioOutput = (rawOutput: unknown): ParsedScenarioOutput => {
  const parsed = parseRawOutput(rawOutput);

  if (!isRecord(parsed)) {
    throw new Error("Invalid scenario output: expected a JSON object.");
  }

  const container = isRecord(parsed.scenarioPack)
    ? parsed.scenarioPack
    : isRecord(parsed.result)
      ? parsed.result
      : parsed;

  const scenarios = normalizeScenarios(container.scenarios);
  const generatedGroupsByFeature = normalizeGroupMap(
    container.groupedByFeature,
    "groupedByFeature",
    "feature",
  );
  const generatedGroupsByOutcome = normalizeGroupMap(
    container.groupedByOutcome,
    "groupedByOutcome",
    "outcome",
  );
  const derivedGroups = deriveGroupsFromScenarios(scenarios);
  const derivedCoverage = buildDerivedCoverage(scenarios);
  const coverageContainer = isRecord(container.coverage) ? container.coverage : null;
  const coverage: ScenarioCoverageSummary = {
    personas: normalizeLooseStringArray(coverageContainer?.personas),
    journeys: normalizeLooseStringArray(coverageContainer?.journeys),
    edgeBuckets: normalizeLooseStringArray(coverageContainer?.edgeBuckets),
    features: normalizeLooseStringArray(coverageContainer?.features),
    outcomes: normalizeLooseStringArray(coverageContainer?.outcomes),
    assumptions: normalizeLooseStringArray(coverageContainer?.assumptions),
    knownUnknowns: normalizeLooseStringArray(coverageContainer?.knownUnknowns),
    uncoveredGaps: normalizeLooseStringArray(coverageContainer?.uncoveredGaps),
  };

  return {
    scenarios,
    coverage: {
      personas: coverage.personas.length > 0 ? coverage.personas : derivedCoverage.personas,
      journeys: coverage.journeys.length > 0 ? coverage.journeys : derivedCoverage.journeys,
      edgeBuckets:
        coverage.edgeBuckets.length > 0 ? coverage.edgeBuckets : derivedCoverage.edgeBuckets,
      features: coverage.features.length > 0 ? coverage.features : derivedCoverage.features,
      outcomes: coverage.outcomes.length > 0 ? coverage.outcomes : derivedCoverage.outcomes,
      assumptions: coverage.assumptions,
      knownUnknowns: coverage.knownUnknowns,
      uncoveredGaps: coverage.uncoveredGaps,
    },
    groupedByFeature:
      Object.keys(generatedGroupsByFeature).length > 0
        ? generatedGroupsByFeature
        : derivedGroups.byFeature,
    groupedByOutcome:
      Object.keys(generatedGroupsByOutcome).length > 0
        ? generatedGroupsByOutcome
        : derivedGroups.byOutcome,
  };
};

const textIncludesKeyword = (value: string, keywords: string[]): boolean => {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
};

const EDGE_BUCKET_RULES: Array<{
  id: string;
  label: string;
  keywords: string[];
  requiredWhen: (baseline: CodeBaseline | null | undefined) => boolean;
}> = [
  {
    id: "validation",
    label: "input validation and malformed payload handling",
    keywords: ["invalid", "malformed", "validation", "required field", "schema"],
    requiredWhen: () => true,
  },
  {
    id: "permissions",
    label: "permission or access-control edge handling",
    keywords: ["permission", "forbidden", "unauthorized", "access denied", "auth"],
    requiredWhen: (baseline) =>
      Boolean(
        baseline?.routeMap.some((route) => route.includes("/dashboard") || route.includes("/projects/")),
      ),
  },
  {
    id: "interruptions",
    label: "interruption/resume/recovery handling",
    keywords: ["interrupt", "resume", "recovery", "restart", "retry"],
    requiredWhen: () => true,
  },
  {
    id: "integration-failure",
    label: "external integration/network failure handling",
    keywords: ["timeout", "network", "rate limit", "api failure", "unavailable", "integration"],
    requiredWhen: (baseline) => Boolean(baseline?.integrations.length),
  },
];

const validateCoverageCompleteness = (
  parsed: ParsedScenarioOutput,
  baseline: CodeBaseline | null | undefined,
): CoverageValidationResult => {
  const errors: string[] = [];
  const scenarios = parsed.scenarios;
  const coverage = parsed.coverage;
  const requiredRules = EDGE_BUCKET_RULES.filter((rule) => rule.requiredWhen(baseline));
  const edgeEvidence = [
    ...coverage.edgeBuckets,
    ...coverage.uncoveredGaps,
    ...scenarios.flatMap((scenario) => scenario.edgeVariants),
  ].join("\n");

  const missingRequiredRules = requiredRules.filter(
    (rule) => !textIncludesKeyword(edgeEvidence, rule.keywords),
  );
  if (missingRequiredRules.length > 0) {
    errors.push(
      `Coverage missing required edge buckets: ${missingRequiredRules
        .map((rule) => `${rule.id} (${rule.label})`)
        .join(", ")}.`,
    );
  }

  const unresolvedRequiredGaps = requiredRules.filter((rule) =>
    coverage.uncoveredGaps.some((gap) => textIncludesKeyword(gap, rule.keywords)),
  );
  if (unresolvedRequiredGaps.length > 0) {
    errors.push(
      `Coverage reports unresolved required gaps: ${unresolvedRequiredGaps
        .map((rule) => rule.id)
        .join(", ")}. Resolve these before execution.`,
    );
  }

  const duplicateIntentKeys = new Set<string>();
  const seenIntentKeys = new Set<string>();
  scenarios.forEach((scenario) => {
    const key = [
      scenario.persona.trim().toLowerCase(),
      (scenario.journey ?? scenario.title).trim().toLowerCase(),
      (scenario.riskIntent ?? "").trim().toLowerCase(),
    ].join("|");
    if (seenIntentKeys.has(key)) {
      duplicateIntentKeys.add(key);
    } else {
      seenIntentKeys.add(key);
    }
  });
  if (duplicateIntentKeys.size > 0) {
    errors.push(
      `Duplicate scenario intent detected for persona+journey+risk: ${[
        ...duplicateIntentKeys,
      ]
        .slice(0, 5)
        .join("; ")}.`,
    );
  }

  const scenariosMissingEvidence = scenarios.filter(
    (scenario) => (scenario.codeEvidenceAnchors?.length ?? 0) === 0,
  );
  if (scenariosMissingEvidence.length > 0) {
    errors.push(
      `Scenarios missing code evidence anchors: ${scenariosMissingEvidence
        .map((scenario) => scenario.id)
        .join(", ")}.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    requiredGapEntries: [
      ...missingRequiredRules.map(
        (rule) => `required edge bucket missing: ${rule.id} (${rule.label})`,
      ),
      ...unresolvedRequiredGaps.map(
        (rule) => `required edge bucket unresolved: ${rule.id} (${rule.label})`,
      ),
    ],
    knownUnknownEntries: errors.map((error) => `coverage-validation: ${error}`),
  };
};

const dedupeStrings = (values: string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];

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
    lines.push("- Test Data:");
    scenario.testData.forEach((item) => lines.push(`  - ${item}`));
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
  input: GenerateScenarioPackInput,
): Omit<ScenarioPack, "id" | "createdAt" | "updatedAt"> => {
  const parsedOutput = parseScenarioOutput(input.rawOutput);
  if (isCodeFirstGenerationEnabled()) {
    const coverageValidation = validateCoverageCompleteness(
      parsedOutput,
      input.codeBaseline ?? null,
    );
    if (!coverageValidation.ok) {
      parsedOutput.coverage.uncoveredGaps = dedupeStrings([
        ...parsedOutput.coverage.uncoveredGaps,
        ...coverageValidation.requiredGapEntries,
      ]);
      parsedOutput.coverage.knownUnknowns = dedupeStrings([
        ...parsedOutput.coverage.knownUnknowns,
        ...coverageValidation.knownUnknownEntries,
      ]);
    }
  }

  return {
    ownerId: input.ownerId,
    projectId: input.project.id,
    manifestId: input.manifest.id,
    manifestHash: input.manifest.manifestHash,
    repositoryFullName: input.manifest.repositoryFullName,
    branch: input.manifest.branch,
    headCommitSha: input.manifest.headCommitSha,
    sourceIds: input.selectedSources.map((source) => source.id),
    model: input.model,
    generationAudit: {
      transport: input.metadata.transport,
      requestedSkill: input.metadata.requestedSkill,
      usedSkill: input.metadata.usedSkill,
      skillAvailable: input.metadata.skillAvailable,
      skillPath: input.metadata.skillPath,
      threadId: input.metadata.threadId,
      turnId: input.metadata.turnId,
      turnStatus: input.metadata.turnStatus,
      cwd: input.metadata.cwd,
      generatedAt: input.metadata.generatedAt ?? nowIso(),
    },
    coverage: parsedOutput.coverage,
    groupedByFeature: parsedOutput.groupedByFeature,
    groupedByOutcome: parsedOutput.groupedByOutcome,
    scenarios: parsedOutput.scenarios,
    scenariosMarkdown: renderScenarioMarkdown(parsedOutput.scenarios),
  };
};
