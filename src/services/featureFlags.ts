const readEnvValue = (key: string): string | null => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : null;
};

const isEnabled = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const isCodeFirstGenerationEnabled = (): boolean =>
  isEnabled(readEnvValue("SCENARIO_CODE_FIRST_GENERATION"));
