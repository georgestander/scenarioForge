import type { SourceRecord, SourceType } from "@/domain/models";

const ALLOWED_EXTENSIONS = [".md", ".markdown", ".json", ".txt"];
const BLOCKED_PATH_PREFIXES = [
  "src/",
  "app/",
  "tests/",
  "scripts/",
  "public/",
  "dist/",
  "build/",
];
const PLANNING_KEYWORDS = [
  "prd",
  "spec",
  "plan",
  "planning",
  "task",
  "backlog",
  "roadmap",
  "architecture",
  "requirement",
  "design",
  "brief",
  "scope",
  "pointer",
  "implementation",
];

const hasAllowedExtension = (path: string): boolean =>
  ALLOWED_EXTENSIONS.some((extension) => path.endsWith(extension));

const hasPlanningSignal = (path: string): boolean => {
  if (path === "readme.md") {
    return true;
  }

  if (path.startsWith("docs/")) {
    return true;
  }

  return PLANNING_KEYWORDS.some((keyword) => path.includes(keyword));
};

export const isSelectableSourcePath = (path: string): boolean => {
  const normalized = path.trim().toLowerCase();

  if (!normalized || !hasAllowedExtension(normalized)) {
    return false;
  }

  if (BLOCKED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }

  return hasPlanningSignal(normalized);
};

export const isSelectableSourceType = (type: SourceType): boolean => type !== "code";

export const isSelectableSourceRecord = (
  source: Pick<SourceRecord, "path" | "type">,
): boolean => isSelectableSourceType(source.type) && isSelectableSourcePath(source.path);
