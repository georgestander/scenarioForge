"use client";

import { useMemo, useState } from "react";
import type { FixAttempt, Project, PullRequestRecord, ScenarioPack, ScenarioRun } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type { ScenarioActionExecutePayload } from "@/app/shared/types";

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
  const idle = !isExecuting && latestRun === null;

  return (
    <section style={{ maxWidth: "520px", margin: "0 auto", padding: "2rem 1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* IDLE */}
      {idle && (
        <>
          <h2 style={{ textAlign: "center", margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.5rem", color: "var(--forge-ink)" }}>
            Execute Scenarios
          </h2>
          <p style={{ textAlign: "center", margin: 0, fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {initialPack.scenarios.length} scenarios ready
          </p>
          <input
            value={executeInstruction}
            onChange={(e) => setExecuteInstruction(e.target.value)}
            placeholder="Optional instruction (e.g. prioritize auth regressions)"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <button
            type="button"
            onClick={() => void handleExecute()}
            style={{ alignSelf: "center", padding: "0.55rem 1.2rem" }}
          >
            Execute Loop
          </button>
        </>
      )}

      {/* EXECUTING: spinner + streaming bullets */}
      {isExecuting && (
        <>
          <div style={{ textAlign: "center", fontSize: "2rem", color: "var(--forge-hot)", animation: "spin 1.8s linear infinite" }}>*</div>
          <h2 style={{ textAlign: "center", margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.5rem", color: "var(--forge-ink)" }}>
            Running Scenarios
          </h2>
          {executeEvents.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem", textAlign: "left" }}>
              {executeEvents.map((event) => (
                <li key={event.id} style={{ fontSize: "0.82rem", lineHeight: 1.4, color: "var(--forge-muted)" }}>
                  <span style={{ color: "var(--forge-fire)" }}>*</span>{" "}
                  {event.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* DONE */}
      {done && (
        <>
          <div style={{ textAlign: "center", fontSize: "1.6rem", color: "var(--forge-ok)" }}>&#10003;</div>
          <h2 style={{ textAlign: "center", margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.5rem", color: "var(--forge-ink)" }}>
            Execution Complete
          </h2>
          <p style={{ textAlign: "center", margin: 0, fontSize: "0.88rem", color: "var(--forge-muted)" }}>
            {latestRun.summary.passed} passed, {latestRun.summary.failed} failed, {latestRun.summary.blocked} blocked
          </p>
          {latestFix && (
            <p style={{ textAlign: "center", margin: 0, fontSize: "0.82rem", color: "var(--forge-fire)" }}>
              Fix attempted &mdash; {latestFix.patchSummary || "patch applied"}
            </p>
          )}
          {pullRequests.length > 0 && (
            <p style={{ textAlign: "center", margin: 0, fontSize: "0.82rem", color: "var(--forge-ok)" }}>
              {pullRequests.length} pull request{pullRequests.length > 1 ? "s" : ""} opened
            </p>
          )}
          <a
            href={`/projects/${projectId}/completed`}
            style={{
              display: "inline-block",
              alignSelf: "center",
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
        </>
      )}
    </section>
  );
};
