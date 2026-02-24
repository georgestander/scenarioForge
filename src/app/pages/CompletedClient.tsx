"use client";

import { useState } from "react";
import type {
  FixAttempt,
  Project,
  PullRequestRecord,
  ReviewBoard,
  ScenarioRun,
} from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type { ReviewBoardPayload, ReviewReportPayload } from "@/app/shared/types";

export const CompletedClient = ({
  projectId,
  project,
  initialRuns,
  initialFixAttempts,
  initialPullRequests,
  initialReviewBoard,
}: {
  projectId: string;
  project: Project;
  initialRuns: ScenarioRun[];
  initialFixAttempts: FixAttempt[];
  initialPullRequests: PullRequestRecord[];
  initialReviewBoard: ReviewBoard | null;
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const [reviewBoard, setReviewBoard] = useState<ReviewBoard | null>(initialReviewBoard);
  const [reviewReport, setReviewReport] = useState("");

  const latestRun = initialRuns[0] ?? null;

  const handleRefreshReviewBoard = async () => {
    const response = await fetch(`/api/projects/${projectId}/review-board`);
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to load review board."));
      return;
    }
    const payload = (await response.json()) as ReviewBoardPayload;
    setReviewBoard(payload.board);
    setStatusMessage("Review board refreshed.");
  };

  const handleExportReport = async () => {
    const response = await fetch(`/api/projects/${projectId}/review-report`);
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to export report."));
      return;
    }
    const payload = (await response.json()) as ReviewReportPayload;
    setReviewReport(payload.markdown);
    setStatusMessage("Challenge report exported.");
  };

  const totalPassed = latestRun?.summary.passed ?? 0;
  const totalFailed = latestRun?.summary.failed ?? 0;
  const totalBlocked = latestRun?.summary.blocked ?? 0;
  const totalScenarios = totalPassed + totalFailed + totalBlocked;

  return (
    <section style={{ maxWidth: "560px", margin: "0 auto", display: "grid", gap: "1.2rem" }}>

      {/* Checkmark + Heading */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "3rem", lineHeight: 1, color: "var(--forge-ok)" }}>
          {"\u2713"}
        </div>
        <h2 style={{
          margin: "0.3rem 0 0",
          fontFamily: "'VT323', monospace",
          fontSize: "1.8rem",
          color: "var(--forge-ok)",
        }}>
          Scenarios Completed
        </h2>
      </div>

      {/* Summary */}
      <p style={{ textAlign: "center", color: "var(--forge-ink)", fontSize: "0.92rem", lineHeight: 1.6, margin: 0 }}>
        <strong>{project.name}</strong>
        {latestRun
          ? <> finished with {totalScenarios} scenario{totalScenarios !== 1 ? "s" : ""}: {totalPassed} passed, {totalFailed} failed, {totalBlocked} blocked.</>
          : <> has no completed runs yet.</>
        }
        {initialPullRequests.length > 0
          ? <> {initialPullRequests.length} PR{initialPullRequests.length !== 1 ? "s" : ""} created.</>
          : null
        }
      </p>

      {statusMessage ? (
        <p style={{
          margin: 0,
          fontSize: "0.85rem",
          color: "var(--forge-muted)",
          textAlign: "center",
          padding: "0.45rem 0.6rem",
          borderRadius: "6px",
          background: "rgba(42, 52, 84, 0.4)",
        }}>
          {statusMessage}
        </p>
      ) : null}

      {/* PR list */}
      {initialPullRequests.length > 0 ? (
        <div>
          <h3 style={{
            margin: "0 0 0.4rem",
            fontFamily: "'VT323', monospace",
            fontSize: "1.2rem",
            color: "var(--forge-ink)",
            textAlign: "center",
          }}>
            Pull Requests
          </h3>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.35rem" }}>
            {initialPullRequests.map((pr) => (
              <li
                key={pr.id}
                style={{
                  fontSize: "0.86rem",
                  color: "var(--forge-muted)",
                  padding: "0.4rem 0.55rem",
                  borderBottom: "1px solid var(--forge-line)",
                }}
              >
                <span style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  padding: "0.1rem 0.3rem",
                  borderRadius: "4px",
                  marginRight: "0.4rem",
                  color: pr.status === "merged" ? "var(--forge-ok)" : pr.status === "open" ? "#5a9af2" : "var(--forge-muted)",
                  background: pr.status === "merged" ? "#1a3a2a" : pr.status === "open" ? "#1a2a3a" : "#3a1a1a",
                }}>
                  {pr.status}
                </span>
                <strong>{pr.title}</strong>
                {pr.url ? (
                  <>
                    {" "}
                    <a href={pr.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.78rem", color: "var(--forge-fire)" }}>
                      view
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviewBoard ? (
        <div style={{ display: "grid", gap: "0.45rem" }}>
          <h3 style={{
            margin: "0 0 0.1rem",
            fontFamily: "'VT323', monospace",
            fontSize: "1.2rem",
            color: "var(--forge-ink)",
            textAlign: "center",
          }}>
            Review Board
          </h3>
          <p style={{ margin: 0, textAlign: "center", color: "var(--forge-muted)", fontSize: "0.83rem" }}>
            Coverage pass rate: <strong style={{ color: "var(--forge-ink)" }}>{reviewBoard.coverage.passRate}%</strong>
          </p>
          {reviewBoard.risks.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.2rem", color: "var(--forge-muted)", fontSize: "0.8rem" }}>
              {reviewBoard.risks.map((risk) => (
                <li key={`${risk.scenarioId}_${risk.reason}`}>
                  <strong style={{ color: "var(--forge-ink)" }}>[{risk.severity}]</strong> {risk.scenarioId}: {risk.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, textAlign: "center", color: "var(--forge-muted)", fontSize: "0.8rem" }}>
              No unresolved risks.
            </p>
          )}
          {reviewBoard.recommendations.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.2rem", color: "var(--forge-muted)", fontSize: "0.8rem" }}>
              {reviewBoard.recommendations.map((rec) => (
                <li key={rec.id}>
                  <strong style={{ color: "var(--forge-ink)" }}>[{rec.priority}]</strong> {rec.title}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Exported report */}
      {reviewReport ? (
        <pre style={{
          margin: 0,
          maxHeight: "200px",
          overflow: "auto",
          border: "1px solid var(--forge-line)",
          borderRadius: "7px",
          background: "#0c101b",
          color: "#d8d4c7",
          padding: "0.52rem",
          fontSize: "0.72rem",
          lineHeight: 1.3,
          textAlign: "left",
        }}>
          {reviewReport}
        </pre>
      ) : null}

      {/* Action buttons */}
      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "1fr 1fr" }}>
        <button type="button" onClick={() => void handleRefreshReviewBoard()}>
          Refresh Review Board
        </button>
        <button type="button" onClick={() => void handleExportReport()}>
          Export Report
        </button>
      </div>

      <div style={{ textAlign: "center" }}>
        <a href="/dashboard" style={{ color: "var(--forge-fire)", fontSize: "0.88rem", textDecoration: "underline" }}>
          Back to Dashboard
        </a>
      </div>
    </section>
  );
};
