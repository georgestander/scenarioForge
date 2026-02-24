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
  const latestFix = initialFixAttempts[0] ?? null;

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

  return (
    <section style={{ display: "grid", gap: "0.55rem" }}>
      <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        Completed
      </h2>
      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Project: <strong>{project.name}</strong> — Summary, PRs, review board, and export.
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

      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button type="button" onClick={handleRefreshReviewBoard}>
          Refresh Review Board
        </button>
        <button
          type="button"
          onClick={handleExportReport}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          Export Report
        </button>
      </div>

      {latestRun ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Latest Run
          </h3>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            <strong>{latestRun.id}</strong>: {latestRun.summary.passed} passed,{" "}
            {latestRun.summary.failed} failed, {latestRun.summary.blocked} blocked.
          </p>

          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Scenario Evidence
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {latestRun.items.map((item) => (
              <li key={item.scenarioId} style={{ lineHeight: 1.3 }}>
                <strong>{item.scenarioId}</strong> [{item.status}] — {item.observed}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No runs completed yet.
        </p>
      )}

      {latestFix ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Latest Fix Attempt
          </h3>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            {latestFix.id} | model {latestFix.model} | status {latestFix.status}
          </p>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            {latestFix.probableRootCause}
          </p>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            {latestFix.patchSummary}
          </p>
        </>
      ) : null}

      {initialPullRequests.length > 0 ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Pull Requests
          </h3>
          <div style={{ display: "grid", gap: "0.42rem" }}>
            {initialPullRequests.map((pr) => (
              <div
                key={pr.id}
                style={{
                  border: "1px solid var(--forge-line)",
                  borderRadius: "9px",
                  padding: "0.48rem 0.55rem",
                  background: "#0f1628",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "0.85rem" }}>{pr.title}</strong>
                  <span style={{
                    fontSize: "0.72rem",
                    padding: "0.12rem 0.35rem",
                    borderRadius: "4px",
                    background: pr.status === "merged" ? "#1a3a2a" : pr.status === "open" ? "#1a2a3a" : "#3a1a1a",
                    color: pr.status === "merged" ? "var(--forge-ok)" : pr.status === "open" ? "#5a9af2" : "var(--forge-muted)",
                    fontWeight: 600,
                  }}>
                    {pr.status}
                  </span>
                </div>
                <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                  {pr.branchName} | {pr.scenarioIds.length} scenario(s)
                </p>
                <p style={{ margin: "0.1rem 0 0", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                  {pr.rootCauseSummary}
                </p>
                {pr.url ? (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.78rem", color: "var(--forge-fire)" }}
                  >
                    {pr.url}
                  </a>
                ) : null}
                {pr.riskNotes.length > 0 ? (
                  <p style={{ margin: "0.1rem 0 0", fontSize: "0.75rem", color: "#f2a96a" }}>
                    Risks: {pr.riskNotes.join("; ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No pull requests created.
        </p>
      )}

      {reviewBoard ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Review Board
          </h3>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            Coverage pass rate: <strong>{reviewBoard.coverage.passRate}%</strong>
          </p>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            Risks: {reviewBoard.risks.length} | PRs: {reviewBoard.pullRequests.length}
          </p>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Recommendations
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {reviewBoard.recommendations.map((rec) => (
              <li key={rec.id} style={{ lineHeight: 1.3 }}>
                [{rec.priority}] {rec.title}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No review board generated yet.
        </p>
      )}

      {reviewReport ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Exported Report
          </h3>
          <pre style={{
            margin: 0,
            maxHeight: "210px",
            overflow: "auto",
            border: "1px solid var(--forge-line)",
            borderRadius: "7px",
            background: "#0c101b",
            color: "#d8d4c7",
            padding: "0.52rem",
            fontSize: "0.72rem",
            lineHeight: 1.3,
          }}>
            {reviewReport}
          </pre>
        </>
      ) : null}

      <a
        href="/dashboard"
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
        }}
      >
        Back to Dashboard
      </a>
    </section>
  );
};
