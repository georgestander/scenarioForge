import type {
  ProjectPrReadinessActuator,
  ProjectPrReadinessReasonCode,
  TelemetryEvent,
  TelemetryEventName,
} from "@/domain/models";
import { createTelemetryEvent, listTelemetryEventsForOwner } from "@/services/store";

const EMPTY_REASON_CODES: ProjectPrReadinessReasonCode[] = [];

export interface RecordTelemetryEventInput {
  ownerId: string;
  projectId: string;
  jobId?: string | null;
  eventName: TelemetryEventName;
  executionMode?: "run" | "fix" | "pr" | "full" | null;
  actuatorPath?: ProjectPrReadinessActuator | null;
  reasonCodes?: ProjectPrReadinessReasonCode[];
  payload?: Record<string, unknown>;
}

export const recordTelemetryEvent = async (
  input: RecordTelemetryEventInput,
): Promise<TelemetryEvent> => {
  const event = createTelemetryEvent({
    ownerId: input.ownerId,
    projectId: input.projectId,
    jobId: input.jobId ?? null,
    eventName: input.eventName,
    executionMode: input.executionMode ?? null,
    actuatorPath: input.actuatorPath ?? null,
    reasonCodes: [...(input.reasonCodes ?? EMPTY_REASON_CODES)],
    payload: { ...(input.payload ?? {}) },
  });
  try {
    const module = await import("@/services/durableCore");
    await module.persistTelemetryEventToD1(event);
  } catch {
    // Keep telemetry best-effort in local/unit-test environments without D1 bindings.
  }
  return event;
};

export interface TelemetryOwnerSummary {
  totalEvents: number;
  eventCounts: Record<TelemetryEventName, number>;
  topBlockerCodes: Array<{
    reasonCode: ProjectPrReadinessReasonCode;
    count: number;
  }>;
  actuatorCounts: Array<{
    actuatorPath: ProjectPrReadinessActuator;
    count: number;
  }>;
}

export const summarizeTelemetryForOwner = (
  ownerId: string,
): TelemetryOwnerSummary => {
  const events = listTelemetryEventsForOwner(ownerId, 3000);
  const eventCounts: TelemetryOwnerSummary["eventCounts"] = {
    readiness_checked: 0,
    full_mode_blocked: 0,
    execute_mode_selected: 0,
    full_mode_started: 0,
    full_mode_completed: 0,
    manual_handoff_emitted: 0,
  };
  const blockerCodeCounts = new Map<ProjectPrReadinessReasonCode, number>();
  const actuatorCounts = new Map<ProjectPrReadinessActuator, number>();

  for (const event of events) {
    eventCounts[event.eventName] += 1;

    for (const reasonCode of event.reasonCodes) {
      blockerCodeCounts.set(reasonCode, (blockerCodeCounts.get(reasonCode) ?? 0) + 1);
    }

    if (event.actuatorPath && event.actuatorPath !== "none") {
      actuatorCounts.set(
        event.actuatorPath,
        (actuatorCounts.get(event.actuatorPath) ?? 0) + 1,
      );
    }
  }

  return {
    totalEvents: events.length,
    eventCounts,
    topBlockerCodes: [...blockerCodeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reasonCode, count]) => ({ reasonCode, count })),
    actuatorCounts: [...actuatorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([actuatorPath, count]) => ({ actuatorPath, count })),
  };
};
