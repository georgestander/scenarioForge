import assert from "node:assert/strict";
import test from "node:test";
import { recordTelemetryEvent, summarizeTelemetryForOwner } from "@/services/telemetry";

test("telemetry summary aggregates event counters and top blocker codes", async () => {
  const ownerId = `usr_telemetry_${Date.now()}`;
  const projectId = "proj_telemetry";

  await recordTelemetryEvent({
    ownerId,
    projectId,
    eventName: "readiness_checked",
    actuatorPath: "controller",
    reasonCodes: ["CODEX_ACCOUNT_NOT_AUTHENTICATED"],
    payload: { status: "needs_attention" },
  });
  await recordTelemetryEvent({
    ownerId,
    projectId,
    eventName: "full_mode_blocked",
    executionMode: "full",
    actuatorPath: "none",
    reasonCodes: ["PR_ACTUATOR_UNAVAILABLE", "CODEX_ACCOUNT_NOT_AUTHENTICATED"],
    payload: { status: "needs_attention" },
  });
  await recordTelemetryEvent({
    ownerId,
    projectId,
    eventName: "execute_mode_selected",
    executionMode: "fix",
    payload: { endpoint: "execute/start" },
  });
  await recordTelemetryEvent({
    ownerId,
    projectId,
    eventName: "full_mode_started",
    executionMode: "full",
    actuatorPath: "controller",
    payload: { endpoint: "execute/start" },
  });
  await recordTelemetryEvent({
    ownerId,
    projectId,
    eventName: "full_mode_completed",
    executionMode: "full",
    actuatorPath: "controller",
    payload: { jobStatus: "completed" },
  });
  await recordTelemetryEvent({
    ownerId,
    projectId,
    eventName: "manual_handoff_emitted",
    executionMode: "full",
    actuatorPath: "controller",
    reasonCodes: ["PR_ACTUATOR_UNAVAILABLE"],
    payload: { manualHandoffCount: 1 },
  });

  const summary = summarizeTelemetryForOwner(ownerId);

  assert.equal(summary.totalEvents, 6);
  assert.equal(summary.eventCounts.readiness_checked, 1);
  assert.equal(summary.eventCounts.full_mode_blocked, 1);
  assert.equal(summary.eventCounts.execute_mode_selected, 1);
  assert.equal(summary.eventCounts.full_mode_started, 1);
  assert.equal(summary.eventCounts.full_mode_completed, 1);
  assert.equal(summary.eventCounts.manual_handoff_emitted, 1);

  const blockerCounts = new Map(
    summary.topBlockerCodes.map((entry) => [entry.reasonCode, entry.count]),
  );
  assert.equal(blockerCounts.get("CODEX_ACCOUNT_NOT_AUTHENTICATED"), 2);
  assert.equal(blockerCounts.get("PR_ACTUATOR_UNAVAILABLE"), 2);

  const controllerActuator = summary.actuatorCounts.find(
    (entry) => entry.actuatorPath === "controller",
  );
  assert.equal(controllerActuator?.count, 4);
});
