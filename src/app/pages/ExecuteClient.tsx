"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FixAttempt, Project, PullRequestRecord, ScenarioPack, ScenarioRun } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type { ScenarioActionExecutePayload } from "@/app/shared/types";

interface ScenarioStatus {
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

  const executeEvents = useMemo(
    () => codexStreamEvents.filter((e) => e.action === "execute"),
    [codexStreamEvents],
  );

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

  // Auto-scroll stream log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [executeEvents.length]);

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
        `Execute completed: ${payload.run.summary.passed} passed, ${payload.run.summary.failed} failed, ${payload.run.summary.blocked} blocked.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Execution failed.");
    } finally {
      setIsExecuting(false);
    }
  };

  const done = !isExecuting && latestRun !== null;

  return (
    <section style={{ maxWidth: "560px", margin: "0 auto", padding: "2rem 1rem", display: "grid", gap: "1rem" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      {/* Heading */}
      <h2 style={{ textAlign: "center", margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.5rem", color: "var(--forge-ink)" }}>
        {isExecuting ? "Running Scenarios" : done ? "Execution Complete" : "Execute Scenarios"}
      </h2>

      {done && (
        <p style={{ textAlign: "center", margin: 0, fontSize: "0.84rem", color: "var(--forge-muted)" }}>
          {latestRun.summary.passed} passed, {latestRun.summary.failed} failed, {latestRun.summary.blocked} blocked
          {latestFix ? ` \u2014 fix attempted` : ""}
          {pullRequests.length > 0 ? ` \u2014 ${pullRequests.length} PR${pullRequests.length > 1 ? "s" : ""} opened` : ""}
        </p>
      )}

      {/* Buttons — always at top */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", alignItems: "end", flexWrap: "wrap" }}>
        {!done && (
          <>
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

      {/* Scenario checklist */}
      <div style={{
        maxHeight: "calc(100vh - 420px)",
        minHeight: "100px",
        overflowY: "auto",
        display: "grid",
        gap: "0.25rem",
      }}>
        {initialPack.scenarios.map((scenario) => {
          const info = finalStatuses.get(scenario.id);
          const st = info?.status ?? "queued";
          const icon = STATUS_ICON[st];
          const isRunning = st === "running";

          return (
            <div
              key={scenario.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.4rem 0.55rem",
                borderRadius: "6px",
                border: "1px solid var(--forge-line)",
                background: isRunning ? "rgba(173, 90, 51, 0.08)" : "transparent",
              }}
            >
              {/* Status icon */}
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
                {/* Title + stage */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                  <span style={{
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    color: "var(--forge-ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {scenario.title}
                  </span>
                  {info?.stage && st === "running" && (
                    <span style={{ fontSize: "0.68rem", color: "var(--forge-fire)", flexShrink: 0 }}>
                      {STAGE_LABEL[info.stage] ?? info.stage}
                    </span>
                  )}
                  {st !== "queued" && st !== "running" && (
                    <span style={{ fontSize: "0.68rem", color: icon?.color ?? "var(--forge-muted)", flexShrink: 0 }}>
                      {st}
                    </span>
                  )}
                </div>

                {/* Latest message subtitle */}
                {info?.message && (
                  <p style={{
                    margin: 0,
                    fontSize: "0.72rem",
                    color: "var(--forge-muted)",
                    lineHeight: 1.35,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {info.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stream log — scrollable, auto-scrolls */}
      {executeEvents.length > 0 && (
        <ul
          ref={logRef}
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            maxHeight: "160px",
            overflowY: "auto",
            display: "grid",
            gap: "0.2rem",
            fontSize: "0.75rem",
            color: "var(--forge-muted)",
            borderTop: "1px solid var(--forge-line)",
            paddingTop: "0.5rem",
          }}
        >
          {executeEvents.map((event) => (
            <li key={event.id} style={{ lineHeight: 1.35 }}>
              <span style={{ color: "var(--forge-fire)" }}>*</span>{" "}
              {event.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
