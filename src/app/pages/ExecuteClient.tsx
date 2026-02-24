"use client";

import { useMemo, useState } from "react";
import type { FixAttempt, Project, PullRequestRecord, ScenarioPack, ScenarioRun } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type { ExecuteBoardRow, ScenarioActionExecutePayload } from "@/app/shared/types";

const buildBoardRows = (
  pack: ScenarioPack | null,
  run: ScenarioRun | null,
  fixAttempt: FixAttempt | null,
): ExecuteBoardRow[] => {
  if (!pack) return [];

  return pack.scenarios.map((scenario) => {
    const runItem = run?.items.find((i) => i.scenarioId === scenario.id);
    const isFailed = fixAttempt?.failedScenarioIds.includes(scenario.id) ?? false;

    let status: ExecuteBoardRow["status"] = "queued";
    let stage: ExecuteBoardRow["stage"] = "run";
    let lastEvent = "Waiting";

    if (runItem) {
      status = runItem.status === "passed" || runItem.status === "failed" || runItem.status === "blocked"
        ? runItem.status
        : "queued";

      if (runItem.status === "failed" && isFailed && fixAttempt) {
        stage = fixAttempt.rerunSummary ? "rerun" : "fix";
        lastEvent = fixAttempt.patchSummary || "Fix attempted";
      } else {
        stage = "run";
        lastEvent = runItem.observed || "Completed";
      }
    }

    return {
      scenarioId: scenario.id,
      title: scenario.title,
      status,
      stage,
      lastEvent,
      attempt: 1,
      lastUpdated: runItem?.completedAt ?? new Date().toISOString(),
      artifactRefs: (runItem?.artifacts ?? []).map((a) => ({ kind: a.kind, label: a.label })),
      failureHypothesis: runItem?.failureHypothesis ?? null,
    };
  });
};

export const ExecuteClient = ({
  projectId,
  project,
  initialPack,
}: {
  projectId: string;
  project: Project;
  initialPack: ScenarioPack;
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const { streamAction, codexStreamEvents, clearStreamEvents } = useStreamAction();
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeInstruction, setExecuteInstruction] = useState("");
  const [latestRun, setLatestRun] = useState<ScenarioRun | null>(null);
  const [latestFix, setLatestFix] = useState<FixAttempt | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);

  const executeEvents = useMemo(
    () => codexStreamEvents.filter((e) => e.action === "execute"),
    [codexStreamEvents],
  );

  const boardRows = useMemo(
    () => buildBoardRows(initialPack, latestRun, latestFix),
    [initialPack, latestRun, latestFix],
  );

  const handleExecute = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    clearStreamEvents();
    setStatusMessage("Executing scenario loop through Codex app-server...");
    try {
      const payload = await streamAction<ScenarioActionExecutePayload>(
        "execute",
        `/api/projects/${projectId}/actions/execute/stream`,
        {
          scenarioPackId: initialPack.id,
          executionMode: "full",
          userInstruction: executeInstruction.trim(),
        },
        "Failed to execute scenario loop.",
      );
      setLatestRun(payload.run);
      if (payload.fixAttempt) {
        setLatestFix(payload.fixAttempt);
      }
      if (payload.pullRequests.length > 0) {
        setPullRequests(payload.pullRequests);
      }

      setStatusMessage(
        `Execute completed (${payload.executionMode}): ${payload.run.summary.passed} passed, ${payload.run.summary.failed} failed, ${payload.run.summary.blocked} blocked.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Execution failed.");
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <section style={{ display: "grid", gap: "0.55rem" }}>
      <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        Execute Scenarios
      </h2>
      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Project: <strong>{project.name}</strong> — Run/fix/PR loop through Codex.
      </p>

      <p style={{
        margin: 0,
        border: "1px solid #6a452f",
        borderRadius: "10px",
        background: "linear-gradient(180deg, rgb(163 87 46 / 0.22) 0%, rgb(97 53 29 / 0.18) 100%)",
        padding: "0.6rem 0.75rem",
        color: "var(--forge-ink)",
        fontSize: "0.9rem",
      }}>
        {statusMessage}
      </p>

      <button type="button" onClick={() => void handleExecute()} disabled={isExecuting}>
        {isExecuting ? "Executing..." : "Execute Loop"}
      </button>

      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Execute instruction (optional)
        <input
          value={executeInstruction}
          onChange={(e) => setExecuteInstruction(e.target.value)}
          placeholder="Example: prioritize auth and source-selection regressions."
        />
      </label>

      {executeEvents.length > 0 ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Codex Stream
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {executeEvents.map((event) => (
              <li key={event.id} style={{ lineHeight: 1.3 }}>
                {event.timestamp} | {event.phase} | {event.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {boardRows.length > 0 ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Scenario Checklist
          </h3>
          <div style={{ display: "grid", gap: "0.42rem" }}>
            {boardRows.map((row) => {
              const statusColor =
                row.status === "passed" ? "var(--forge-ok)"
                  : row.status === "failed" ? "#f25a5a"
                    : row.status === "running" ? "var(--forge-fire)"
                      : "var(--forge-muted)";

              return (
                <div
                  key={row.scenarioId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "center",
                    gap: "0.5rem",
                    border: "1px solid var(--forge-line)",
                    borderRadius: "9px",
                    padding: "0.48rem 0.55rem",
                    background: "#0f1628",
                  }}
                >
                  <span style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: statusColor,
                  }} />
                  <div>
                    <strong style={{ fontSize: "0.85rem" }}>{row.title}</strong>
                    <p style={{ margin: "0.1rem 0 0", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                      {row.scenarioId} | {row.stage} | attempt {row.attempt} | {row.lastEvent}
                    </p>
                    {row.failureHypothesis ? (
                      <p style={{ margin: "0.1rem 0 0", fontSize: "0.75rem", color: "#f2a96a" }}>
                        Hypothesis: {row.failureHypothesis}
                      </p>
                    ) : null}
                    {row.artifactRefs.length > 0 ? (
                      <p style={{ margin: "0.1rem 0 0", fontSize: "0.75rem", color: "var(--forge-muted)" }}>
                        Artifacts: {row.artifactRefs.map((a) => `${a.kind}:${a.label}`).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <span style={{
                    fontSize: "0.75rem",
                    padding: "0.12rem 0.35rem",
                    borderRadius: "4px",
                    background: row.status === "passed" ? "#1a3a2a" : row.status === "failed" ? "#3a1a1a" : "#1a2a3a",
                    color: statusColor,
                    fontWeight: 600,
                  }}>
                    {row.status}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {latestRun ? (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          Run <strong>{latestRun.id}</strong>: {latestRun.summary.passed} passed,{" "}
          {latestRun.summary.failed} failed, {latestRun.summary.blocked} blocked.
        </p>
      ) : null}

      <a
        href={`/projects/${projectId}/completed`}
        style={{
          display: "inline-block",
          padding: "0.52rem 0.62rem",
          borderRadius: "7px",
          border: "1px solid #7f482b",
          background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
          color: "var(--forge-ink)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.89rem",
          textAlign: "center",
          opacity: latestRun ? 1 : 0.55,
          pointerEvents: latestRun ? "auto" : "none",
        }}
      >
        View Results →
      </a>
    </section>
  );
};
