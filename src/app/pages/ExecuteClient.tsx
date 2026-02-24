"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FixAttempt,
  Project,
  ProjectPrReadiness,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
} from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type {
  ProjectPrReadinessPayload,
  ScenarioActionExecutePayload,
} from "@/app/shared/types";

interface ScenarioStatus {
  status: string;
  stage: string;
  message: string;
}

interface ScenarioRow {
  scenarioId: string;
  title: string;
  status: string;
  stage: string;
  message: string;
}

const STATUS_ICON: Record<string, { char: string; color: string }> = {
  running: { char: "\u21BB", color: "var(--forge-fire)" },
  passed: { char: "\u2713", color: "var(--forge-ok)" },
  failed: { char: "\u2717", color: "#e25555" },
  blocked: { char: "\u2014", color: "var(--forge-muted)" },
};

const STAGE_LABEL: Record<string, string> = {
  run: "running",
  fix: "fixing",
  rerun: "rerunning",
  pr: "creating PR",
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
  const logRef = useRef<HTMLUListElement>(null);
  const [traceMode, setTraceMode] = useState(false);
  const [executionMode, setExecutionMode] = useState<"run" | "fix" | "pr" | "full">("full");
  const [prReadiness, setPrReadiness] = useState<ProjectPrReadiness | null>(null);
  const [isCheckingPrReadiness, setIsCheckingPrReadiness] = useState(false);

  const executeEvents = useMemo(
    () => codexStreamEvents.filter((e) => e.action === "execute"),
    [codexStreamEvents],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setTraceMode(new URLSearchParams(window.location.search).get("trace") === "1");
  }, []);

  const loadPrReadiness = async () => {
    const response = await fetch(`/api/projects/${projectId}/pr-readiness`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as ProjectPrReadinessPayload;
    setPrReadiness(payload.readiness ?? null);
  };

  const handleCheckPrReadiness = async () => {
    if (isCheckingPrReadiness) return;
    setIsCheckingPrReadiness(true);
    setStatusMessage("Checking PR automation readiness...");
    try {
      const response = await fetch(`/api/projects/${projectId}/pr-readiness`, {
        method: "POST",
      });
      if (!response.ok) {
        const text = await response.text();
        setStatusMessage(`Failed to check PR readiness. ${text}`);
        return;
      }
      const payload = (await response.json()) as ProjectPrReadinessPayload;
      setPrReadiness(payload.readiness ?? null);
      if (payload.readiness?.status === "ready") {
        setStatusMessage("PR automation is ready.");
      } else {
        setStatusMessage("PR automation needs attention before full execute mode.");
      }
    } finally {
      setIsCheckingPrReadiness(false);
    }
  };

  useEffect(() => {
    void loadPrReadiness();
  }, [projectId]);

  const fullModeReady = prReadiness?.status === "ready";

  useEffect(() => {
    if (!fullModeReady && executionMode === "full") {
      setExecutionMode("fix");
    }
  }, [fullModeReady, executionMode]);

  // Filter out raw protocol noise (e.g. "codex/event/agent_message_content_delta")
  const filteredEvents = useMemo(
    () => executeEvents.filter((e) => {
      const msg = e.message;
      if (msg === e.event) return false;
      if (msg.includes("/") && !msg.includes(" ")) return false;
      return true;
    }),
    [executeEvents],
  );
  const displayEvents = useMemo(() => {
    if (traceMode) {
      return executeEvents;
    }
    if (filteredEvents.length > 0) {
      return filteredEvents;
    }
    // If every event looks "noisy", still show raw events so UI never appears frozen.
    return executeEvents;
  }, [traceMode, filteredEvents, executeEvents]);
  const hiddenEventCount = Math.max(executeEvents.length - filteredEvents.length, 0);

  // Build per-scenario status map from stream events (last event per scenario wins)
  const scenarioStatuses = useMemo(() => {
    const map = new Map<string, ScenarioStatus>();
    for (const evt of executeEvents) {
      if (evt.scenarioId) {
        map.set(evt.scenarioId, {
          status: evt.status ?? "running",
          stage: evt.stage ?? "run",
          message: evt.message,
        });
      }
    }
    return map;
  }, [executeEvents]);

  // Override with definitive results from completed run
  const finalStatuses = useMemo(() => {
    if (!latestRun) return scenarioStatuses;
    const map = new Map(scenarioStatuses);
    for (const item of latestRun.items) {
      map.set(item.scenarioId, {
        status: item.status,
        stage: "run",
        message: item.observed || (item.status === "passed" ? "Passed" : item.failureHypothesis ?? ""),
      });
    }
    return map;
  }, [scenarioStatuses, latestRun]);

  const scenarioRows = useMemo<ScenarioRow[]>(() => {
    return initialPack.scenarios.map((scenario, index) => {
      const info = finalStatuses.get(scenario.id);
      const fallbackRunning = isExecuting && executeEvents.length === 0 && index === 0;
      const status = info?.status ?? (fallbackRunning ? "running" : "queued");
      const stage = info?.stage ?? "run";
      const message = info?.message ?? (status === "running" ? "Starting execution..." : "Queued");

      return {
        scenarioId: scenario.id,
        title: scenario.title,
        status,
        stage,
        message,
      };
    });
  }, [initialPack.scenarios, finalStatuses, isExecuting, executeEvents.length]);

  const activeScenarioId = useMemo(() => {
    const running = scenarioRows.find((row) => row.status === "running");
    if (running) {
      return running.scenarioId;
    }
    if (isExecuting) {
      const completedCount = scenarioRows.filter(
        (row) =>
          row.status === "passed" || row.status === "failed" || row.status === "blocked",
      ).length;
      const activeIndex = Math.min(
        completedCount,
        Math.max(scenarioRows.length - 1, 0),
      );
      return scenarioRows[activeIndex]?.scenarioId ?? null;
    }
    return null;
  }, [scenarioRows, isExecuting]);

  // Auto-scroll stream log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [executeEvents.length]);

  const handleExecute = async () => {
    if (isExecuting) return;
    if (executionMode === "full" && !fullModeReady) {
      setStatusMessage("Full mode is blocked until PR automation readiness is green.");
      return;
    }
    setIsExecuting(true);
    clearStreamEvents();
    setStatusMessage("Executing scenario loop through Codex app-server...");
    try {
      const payload = await streamAction<ScenarioActionExecutePayload>(
        "execute",
        `/api/projects/${projectId}/actions/execute/stream`,
        {
          scenarioPackId: initialPack.id,
          executionMode,
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
        `Execute completed: ${payload.run.summary.passed} passed, ${payload.run.summary.failed} failed, ${payload.run.summary.blocked} blocked.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Execution failed.");
    } finally {
      setIsExecuting(false);
    }
  };

  const done = !isExecuting && latestRun !== null;

  const panelHeight = "calc(100vh - 300px)";

  return (
    <section style={{ margin: "0 auto", padding: "1.5rem 1rem", display: "grid", gap: "1rem" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .execute-panels {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 220px;
          gap: 0.75rem;
          align-items: start;
        }
        .execute-scenario-list {
          overflow-x: hidden;
        }
        .execute-stream-log {
          width: 220px;
          max-width: 220px;
          justify-self: end;
          overflow-x: hidden;
        }
        .execute-stream-log li {
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        @media (max-width: 960px) {
          .execute-panels {
            grid-template-columns: 1fr;
          }
          .execute-stream-log {
            width: 100%;
            max-width: none;
            justify-self: stretch;
            border-left: none !important;
            border-top: 1px solid var(--forge-line);
            padding-top: 0.65rem;
          }
        }
      `}</style>

      {/* Heading */}
      <h2 style={{ textAlign: "center", margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.5rem", color: "var(--forge-ink)" }}>
        {isExecuting ? "Running Scenarios" : done ? "Execution Complete" : "Execute Scenarios"}
      </h2>
      {statusMessage ? (
        <p style={{ textAlign: "center", margin: 0, fontSize: "0.84rem", color: "var(--forge-muted)" }}>
          {statusMessage}
        </p>
      ) : null}
      {!traceMode && hiddenEventCount > 0 && filteredEvents.length > 0 ? (
        <p style={{ textAlign: "center", margin: 0, fontSize: "0.75rem", color: "var(--forge-muted)" }}>
          {hiddenEventCount} low-level events hidden. Add <code>?trace=1</code> for raw stream debugging.
        </p>
      ) : null}

      {done && (
        <p style={{ textAlign: "center", margin: 0, fontSize: "0.84rem", color: "var(--forge-muted)" }}>
          {latestRun.summary.passed} passed, {latestRun.summary.failed} failed, {latestRun.summary.blocked} blocked
          {latestFix ? ` \u2014 fix attempted` : ""}
          {pullRequests.length > 0 ? ` \u2014 ${pullRequests.length} PR${pullRequests.length > 1 ? "s" : ""} opened` : ""}
        </p>
      )}

      <div
        style={{
          border: "1px solid var(--forge-line)",
          borderRadius: "8px",
          background: "rgba(18, 24, 43, 0.6)",
          padding: "0.55rem 0.65rem",
          display: "grid",
          gap: "0.35rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <strong style={{ color: "var(--forge-ink)", fontSize: "0.84rem" }}>
            PR automation readiness
          </strong>
          <span
            style={{
              fontSize: "0.75rem",
              color: fullModeReady ? "var(--forge-ok)" : "var(--forge-fire)",
              fontWeight: 600,
            }}
          >
            {prReadiness ? (fullModeReady ? "ready" : "needs attention") : "not checked"}
          </span>
        </div>
        {prReadiness?.reasons.length ? (
          <ul style={{ margin: 0, paddingLeft: "1rem", color: "var(--forge-muted)", fontSize: "0.75rem", display: "grid", gap: "0.2rem" }}>
            {prReadiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        {prReadiness?.recommendedActions.length ? (
          <ul style={{ margin: 0, paddingLeft: "1rem", color: "var(--forge-muted)", fontSize: "0.74rem", display: "grid", gap: "0.2rem" }}>
            {prReadiness.recommendedActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void handleCheckPrReadiness()} disabled={isCheckingPrReadiness || isExecuting}>
            {isCheckingPrReadiness ? "Checking..." : "Check PR readiness"}
          </button>
        </div>
      </div>

      {/* Buttons — always at top */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", alignItems: "end", flexWrap: "wrap" }}>
        {!done && (
          <>
            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--forge-muted)" }}>
              Mode
              <select
                value={executionMode}
                onChange={(event) =>
                  setExecutionMode(event.target.value as "run" | "fix" | "pr" | "full")
                }
                disabled={isExecuting}
                style={{ minWidth: "120px" }}
              >
                <option value="run">run only</option>
                <option value="fix">run + fix</option>
                <option value="pr">run + fix + pr</option>
                <option value="full" disabled={!fullModeReady}>
                  full loop (requires PR readiness)
                </option>
              </select>
            </label>
            <input
              value={executeInstruction}
              onChange={(e) => setExecuteInstruction(e.target.value)}
              placeholder="Optional instruction"
              disabled={isExecuting}
              style={{ flex: 1, minWidth: "140px", boxSizing: "border-box" }}
            />
            <button
              type="button"
              onClick={() => void handleExecute()}
              disabled={isExecuting}
              style={{ whiteSpace: "nowrap", padding: "0.55rem 1.2rem" }}
            >
              {isExecuting ? "Running..." : "Execute Loop"}
            </button>
          </>
        )}
        {done && (
          <a
            href={`/projects/${projectId}/completed`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.5rem 1.2rem",
              borderRadius: "7px",
              border: "1px solid #7f482b",
              background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
              color: "var(--forge-ink)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
            }}
          >
            View Results
          </a>
        )}
      </div>

      {/* Side-by-side: checklist (left) + stream log (right) */}
      <div className="execute-panels">

        {/* Scenario checklist */}
        <div className="execute-scenario-list" style={{
          maxHeight: panelHeight,
          minHeight: "120px",
          overflowY: "auto",
          display: "grid",
          gap: "0.25rem",
          alignContent: "start",
        }}>
          {scenarioRows.map((row) => {
            const st = row.status;
            const isRunning = activeScenarioId === row.scenarioId;
            const displayStatus = isRunning && st === "queued" ? "running" : st;
            const icon = STATUS_ICON[displayStatus];
            const detailMessage =
              isRunning && st === "queued" ? "Executing current scenario..." : row.message;

            return (
              <div
                key={row.scenarioId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  padding: "0.4rem 0.55rem",
                  borderRadius: "6px",
                  border: isRunning ? "1px solid var(--forge-fire)" : "1px solid var(--forge-line)",
                  background:
                    row.status === "passed"
                      ? "rgba(38, 91, 58, 0.2)"
                      : row.status === "failed"
                        ? "rgba(122, 49, 49, 0.18)"
                        : row.status === "blocked"
                          ? "rgba(74, 84, 112, 0.16)"
                          : isRunning
                            ? "rgba(173, 90, 51, 0.13)"
                            : "transparent",
                }}
              >
                <span style={{
                  flexShrink: 0,
                  width: "1.1rem",
                  textAlign: "center",
                  fontSize: "0.88rem",
                  lineHeight: "1.3",
                  color: icon?.color ?? "var(--forge-muted)",
                  animation: isRunning ? "pulse 1.4s ease-in-out infinite" : undefined,
                }}>
                  {icon?.char ?? "\u25CB"}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      color: "var(--forge-ink)",
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}>
                      {row.title}
                    </span>
                    {row.stage && displayStatus === "running" && (
                      <span style={{ fontSize: "0.68rem", color: "var(--forge-fire)", flexShrink: 0 }}>
                        {STAGE_LABEL[row.stage] ?? row.stage}
                      </span>
                    )}
                    {displayStatus !== "queued" && displayStatus !== "running" && (
                      <span style={{ fontSize: "0.68rem", color: icon?.color ?? "var(--forge-muted)", flexShrink: 0 }}>
                        {displayStatus}
                      </span>
                    )}
                  </div>
                  {detailMessage && (
                    <p style={{
                      margin: 0,
                      fontSize: "0.72rem",
                      color: "var(--forge-muted)",
                      lineHeight: 1.35,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}>
                      {detailMessage}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Stream log — right column */}
        <ul
          ref={logRef}
          className="execute-stream-log"
          style={{
            margin: 0,
            padding: "0.5rem",
            listStyle: "none",
            maxHeight: panelHeight,
            minHeight: "120px",
            overflowY: "auto",
            display: "grid",
            gap: "0.15rem",
            alignContent: "start",
            fontSize: "0.72rem",
            color: "var(--forge-muted)",
            borderLeft: "1px solid var(--forge-line)",
          }}
        >
          {displayEvents.length > 0 ? (
            displayEvents.map((event) => (
              <li key={event.id} style={{ lineHeight: 1.3 }}>
                <span style={{ color: "var(--forge-fire)" }}>*</span>{" "}
                {event.message}
                {traceMode && (event.scenarioId || event.status || event.stage) ? (
                  <span style={{ color: "var(--forge-muted)" }}>
                    {" "}
                    [{event.scenarioId ?? "-"} | {event.stage ?? "-"} | {event.status ?? "-"}]
                  </span>
                ) : null}
              </li>
            ))
          ) : (
            <li style={{ color: "var(--forge-muted)", fontStyle: "italic" }}>
              {isExecuting ? "Waiting for stream events..." : "Stream log"}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
};
