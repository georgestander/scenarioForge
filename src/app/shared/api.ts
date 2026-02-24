import type { Stage } from "./types.js";

export const readError = async (
  response: Response,
  fallbackMessage: string,
): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

export const parseSsePayload = (raw: string): unknown => {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

export const readStreamError = (payload: unknown, fallback: string): string => {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }

  return fallback;
};

export const stageTitle = (stage: Stage): string => {
  switch (stage) {
    case 1:
      return "Connect";
    case 2:
      return "Select Sources";
    case 3:
      return "Generate";
    case 4:
      return "Run";
    case 5:
      return "Auto-Fix";
    case 6:
      return "Review";
  }
};

export const openInNewTab = (
  url: string,
  targetLabel = "link",
): "opened" | "blocked" => {
  const newWindow = window.open(url, "_blank", "noopener,noreferrer");

  if (newWindow) {
    return "opened";
  }

  return "blocked";
};
