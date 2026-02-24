"use client";

import { useMemo, useState } from "react";
import type {
  FixAttempt,
  Project,
  PullRequestRecord,
  ReviewBoard,
  ScenarioRun,
} from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type { ReviewBoardPayload } from "@/app/shared/types";

const STATUS_COLORS: Record<string, string> = {
  passed: "var(--forge-ok)",
  failed: "#e25555",
  blocked: "var(--forge-muted)",
  running: "var(--forge-fire)",
  queued: "var(--forge-muted)",
};

const isLikelyUrl = (value: string): boolean =>
  /^https?:\/\//i.test(value) || value.startsWith("/");

const parseDownloadFilename = (
  contentDisposition: string | null,
  fallback: string,
): string => {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (filenameMatch?.[1]) {
    return filenameMatch[1];
  }

  return fallback;
};

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

  const latestRun = initialRuns[0] ?? null;
  const latestFixAttempt = initialFixAttempts[0] ?? null;
  const pullRequestsByScenarioId = useMemo(() => {
    return initialPullRequests.reduce(
      (acc, pullRequest) => {
        for (const scenarioId of pullRequest.scenarioIds) {
          const existing = acc.get(scenarioId) ?? [];
          existing.push(pullRequest);
          acc.set(scenarioId, existing);
        }
        return acc;
      },
      new Map<string, PullRequestRecord[]>(),
    );
  }, [initialPullRequests]);

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
    const response = await fetch(`/api/projects/${projectId}/review-report?format=markdown`);
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to export report."));
      return;
    }

    const blob = await response.blob();
    const fallbackName = `${project.id}-challenge-report.md`;
    const filename = parseDownloadFilename(
      response.headers.get("content-disposition"),
      fallbackName,
    );
    const downloadUrl = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);

    setStatusMessage("Challenge report downloaded.");
  };

  const totalPassed = latestRun?.summary.passed ?? 0;
  const totalFailed = latestRun?.summary.failed ?? 0;
  const totalBlocked = latestRun?.summary.blocked ?? 0;
  const totalScenarios = totalPassed + totalFailed + totalBlocked;

  return (
    <section style={{ maxWidth: "900px", margin: "0 auto", display: "grid", gap: "1.2rem" }}>

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

      {latestRun ? (
        <div
          style={{
            display: "grid",
            gap: "0.35rem",
            border: "1px solid var(--forge-line)",
            borderRadius: "8px",
            padding: "0.55rem 0.7rem",
            background: "rgba(42, 52, 84, 0.24)",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--forge-muted)" }}>
            Run ID: <strong style={{ color: "var(--forge-ink)" }}>{latestRun.id}</strong>
          </p>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--forge-muted)" }}>
            Completed:{" "}
            <strong style={{ color: "var(--forge-ink)" }}>
              {latestRun.completedAt ?? "in progress"}
            </strong>
          </p>
          {latestFixAttempt ? (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--forge-muted)" }}>
              Latest fix attempt:{" "}
              <strong style={{ color: "var(--forge-ink)" }}>{latestFixAttempt.status}</strong> (
              {latestFixAttempt.failedScenarioIds.length} failed scenario
              {latestFixAttempt.failedScenarioIds.length === 1 ? "" : "s"} targeted)
            </p>
          ) : null}
        </div>
      ) : null}

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

      {/* Primary actions */}
      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "1fr 1fr" }}>
        <button type="button" onClick={() => void handleRefreshReviewBoard()}>
          Refresh Review Board
        </button>
        <button type="button" onClick={() => void handleExportReport()}>
          Export Report
        </button>
      </div>

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
                  display: "grid",
                  gap: "0.25rem",
                }}
              >
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
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
                    <a href={pr.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.78rem", color: "var(--forge-fire)" }}>
                      view
                    </a>
                  ) : (
                    <span style={{ fontSize: "0.78rem", color: "var(--forge-fire)" }}>
                      manual handoff
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: "0.75rem" }}>
                  Branch: <strong style={{ color: "var(--forge-ink)" }}>{pr.branchName}</strong>
                </p>
                <p style={{ margin: 0, fontSize: "0.75rem" }}>
                  Root cause: <strong style={{ color: "var(--forge-ink)" }}>{pr.rootCauseSummary}</strong>
                </p>
                {pr.riskNotes.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: "1rem", display: "grid", gap: "0.15rem", fontSize: "0.74rem" }}>
                    {pr.riskNotes.map((riskNote) => (
                      <li key={`${pr.id}_${riskNote}`}>{riskNote}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {latestRun ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <h3
            style={{
              margin: 0,
              fontFamily: "'VT323', monospace",
              fontSize: "1.2rem",
              color: "var(--forge-ink)",
              textAlign: "center",
            }}
          >
            Scenario Checks
          </h3>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.45rem" }}>
            {latestRun.items.map((item) => {
              const scenarioPullRequests = pullRequestsByScenarioId.get(item.scenarioId) ?? [];
              const statusColor = STATUS_COLORS[item.status] ?? "var(--forge-muted)";

              return (
                <li
                  key={item.scenarioId}
                  style={{
                    border: "1px solid var(--forge-line)",
                    borderRadius: "8px",
                    padding: "0.5rem 0.6rem",
                    background: "rgba(18, 24, 43, 0.6)",
                    display: "grid",
                    gap: "0.3rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ color: "var(--forge-ink)", fontSize: "0.88rem" }}>
                      {item.scenarioId}
                    </strong>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        color: statusColor,
                        border: `1px solid ${statusColor}`,
                        borderRadius: "999px",
                        padding: "0.05rem 0.38rem",
                        lineHeight: 1.2,
                      }}
                    >
                      {item.status}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: "0.79rem", color: "var(--forge-muted)" }}>
                    <strong style={{ color: "var(--forge-ink)" }}>Expected:</strong> {item.expected}
                  </p>
                  <p style={{ margin: 0, fontSize: "0.79rem", color: "var(--forge-muted)" }}>
                    <strong style={{ color: "var(--forge-ink)" }}>Observed:</strong> {item.observed}
                  </p>

                  {item.failureHypothesis ? (
                    <p style={{ margin: 0, fontSize: "0.79rem", color: "var(--forge-muted)" }}>
                      <strong style={{ color: "var(--forge-ink)" }}>Failure hypothesis:</strong>{" "}
                      {item.failureHypothesis}
                    </p>
                  ) : null}

                  {item.artifacts.length > 0 ? (
                    <div style={{ display: "grid", gap: "0.2rem" }}>
                      <p style={{ margin: 0, fontSize: "0.76rem", color: "var(--forge-ink)" }}>
                        Artifacts
                      </p>
                      <ul style={{ margin: 0, paddingLeft: "1rem", color: "var(--forge-muted)", fontSize: "0.75rem", display: "grid", gap: "0.15rem" }}>
                        {item.artifacts.map((artifact) => (
                          <li key={`${item.scenarioId}_${artifact.kind}_${artifact.label}`}>
                            {isLikelyUrl(artifact.value) ? (
                              <a href={artifact.value} target="_blank" rel="noopener noreferrer" style={{ color: "var(--forge-fire)" }}>
                                {artifact.label}
                              </a>
                            ) : (
                              <span>{artifact.label}</span>
                            )}{" "}
                            ({artifact.kind})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {scenarioPullRequests.length > 0 ? (
                    <div style={{ display: "grid", gap: "0.2rem" }}>
                      <p style={{ margin: 0, fontSize: "0.76rem", color: "var(--forge-ink)" }}>
                        Related PRs
                      </p>
                      <ul style={{ margin: 0, paddingLeft: "1rem", color: "var(--forge-muted)", fontSize: "0.75rem", display: "grid", gap: "0.15rem" }}>
                        {scenarioPullRequests.map((pullRequest) => (
                          <li key={`${item.scenarioId}_${pullRequest.id}`}>
                            {pullRequest.url ? (
                              <a href={pullRequest.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--forge-fire)" }}>
                                {pullRequest.title}
                              </a>
                            ) : (
                              <span style={{ color: "var(--forge-fire)" }}>{pullRequest.title}</span>
                            )}{" "}
                            ({pullRequest.status}) — {pullRequest.branchName}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
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

      <div style={{ textAlign: "center" }}>
        <a href="/dashboard" style={{ color: "var(--forge-fire)", fontSize: "0.88rem", textDecoration: "underline" }}>
          Back to Dashboard
        </a>
      </div>
    </section>
  );
};
