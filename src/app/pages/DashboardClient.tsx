"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/domain/models";
import { readError } from "@/app/shared/api";
import { DEFAULT_STATUS_MESSAGE, useSession } from "@/app/shared/SessionContext";
import type { ActiveExecutionJobsPayload } from "@/app/shared/types";
import type {
  DashboardActiveRunSummary,
  DashboardLatestRunOutcome,
  DashboardRepoGroup,
} from "./dashboardModels";

const OUTCOME_STYLES: Record<
  DashboardLatestRunOutcome,
  { label: string; color: string; borderColor: string; background: string }
> = {
  idle: {
    label: "Ready",
    color: "#cfd8ee",
    borderColor: "#495777",
    background: "rgba(73, 87, 119, 0.2)",
  },
  queued: {
    label: "Queued",
    color: "#d0d7ea",
    borderColor: "#4b5a78",
    background: "rgba(75, 90, 120, 0.22)",
  },
  running: {
    label: "Running",
    color: "#8fc0ff",
    borderColor: "#2f6ba5",
    background: "rgba(47, 107, 165, 0.22)",
  },
  passed: {
    label: "Passed",
    color: "#8fe3a4",
    borderColor: "#2a8a47",
    background: "rgba(42, 138, 71, 0.22)",
  },
  failed: {
    label: "Failed",
    color: "#ffaba7",
    borderColor: "#a14745",
    background: "rgba(161, 71, 69, 0.22)",
  },
  blocked: {
    label: "Blocked",
    color: "#ffd8a6",
    borderColor: "#a5692f",
    background: "rgba(165, 105, 47, 0.22)",
  },
};

const ACTIVE_RUN_STYLES: Record<
  DashboardActiveRunSummary["status"],
  { label: string; color: string; borderColor: string; background: string }
> = {
  queued: {
    label: "Queued",
    color: "#d0d7ea",
    borderColor: "#4b5a78",
    background: "rgba(75, 90, 120, 0.22)",
  },
  running: {
    label: "Running",
    color: "#8fc0ff",
    borderColor: "#2f6ba5",
    background: "rgba(47, 107, 165, 0.22)",
  },
  completed: {
    label: "Completed",
    color: "#8fe3a4",
    borderColor: "#2a8a47",
    background: "rgba(42, 138, 71, 0.22)",
  },
  failed: {
    label: "Failed",
    color: "#ffaba7",
    borderColor: "#a14745",
    background: "rgba(161, 71, 69, 0.22)",
  },
  blocked: {
    label: "Blocked",
    color: "#ffd8a6",
    borderColor: "#a5692f",
    background: "rgba(165, 105, 47, 0.22)",
  },
};

const formatUtcTimestamp = (isoTimestamp: string): string => {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) {
    return isoTimestamp;
  }

  const normalized = new Date(parsed).toISOString();
  return `${normalized.slice(0, 10)} ${normalized.slice(11, 16)} UTC`;
};

export const DashboardClient = ({
  initialRepoGroups,
  initialActiveRuns,
}: {
  initialRepoGroups: DashboardRepoGroup[];
  initialActiveRuns: DashboardActiveRunSummary[];
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const [activeRuns, setActiveRuns] =
    useState<DashboardActiveRunSummary[]>(initialActiveRuns);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const visibleStatusMessage = useMemo(() => {
    const trimmed = statusMessage.trim();
    if (!trimmed || trimmed === DEFAULT_STATUS_MESSAGE) {
      return "";
    }
    if (trimmed.length <= 260) {
      return trimmed;
    }
    return `${trimmed.slice(0, 257)}...`;
  }, [statusMessage]);

  useEffect(() => {
    let cancelled = false;

    const pollActiveRuns = async () => {
      try {
        const response = await fetch("/api/jobs/active");
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as ActiveExecutionJobsPayload;
        if (cancelled) {
          return;
        }

        const rows = payload.data
          .map((item) => {
            if (!item.project) {
              return null;
            }
            return {
              jobId: item.job.id,
              projectId: item.job.projectId,
              projectName: item.project.name,
              repoUrl: item.project.repoUrl,
              branch: item.project.defaultBranch,
              executionMode: item.job.executionMode,
              status: item.job.status,
              startedAt: item.job.startedAt,
              updatedAt: item.job.updatedAt,
            };
          })
          .filter((row): row is DashboardActiveRunSummary => Boolean(row))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setActiveRuns(rows);
      } catch {
        // Keep existing data when transient polling failures happen.
      }
    };

    const timer = window.setInterval(() => {
      void pollActiveRuns();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const activeProjectIds = new Set(activeRuns.map((run) => run.projectId));

  const handleDeleteProjectRuns = async (projectId: string, projectName: string) => {
    if (deletingProjectId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete previous runs for "${projectName}"? This removes run history, fix attempts, PR records, and execution logs for this project.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingProjectId(projectId);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenario-runs/clear`, {
        method: "POST",
      });
      if (!response.ok) {
        setStatusMessage(await readError(response, "Failed to delete project run history."));
        return;
      }

      const payload = (await response.json()) as {
        deleted: {
          scenarioRuns: number;
          executionJobs: number;
          executionJobEvents: number;
          fixAttempts: number;
          pullRequests: number;
        };
      };

      setStatusMessage(
        `Deleted ${payload.deleted.scenarioRuns} run(s), ${payload.deleted.fixAttempts} fix attempt(s), and ${payload.deleted.pullRequests} PR record(s).`,
      );
      window.location.reload();
    } finally {
      setDeletingProjectId(null);
    }
  };

  const handleNewProject = async () => {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Project" }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to create project."));
      return;
    }

    const payload = (await response.json()) as { project: Project };
    // Navigate directly to the connect page for the new project
    window.location.href = `/projects/${payload.project.id}/connect`;
  };

  return (
    <section style={{ display: "grid", gap: "0.75rem" }}>
      <div
        style={{
          border: "1px solid var(--forge-line)",
          borderRadius: "10px",
          background: "linear-gradient(180deg, rgba(18, 24, 43, 0.7) 0%, rgba(12, 18, 34, 0.8) 100%)",
          padding: "0.6rem",
          display: "grid",
          gridTemplateColumns: "120px minmax(0, 1fr)",
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <img
          src="/scenarioForge.png"
          alt="Scenario Forge mission control"
          style={{
            width: "120px",
            height: "78px",
            objectFit: "cover",
            borderRadius: "7px",
            border: "1px solid var(--forge-line)",
            display: "block",
          }}
        />
        <div style={{ display: "grid", gap: "0.18rem" }}>
          <strong style={{ color: "var(--forge-ink)", fontSize: "0.93rem" }}>
            Scenario Forge Mission Control
          </strong>
          <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.78rem", lineHeight: 1.45 }}>
            Select a project, continue the wizard, and stream scenario execution evidence through to final report and PR handoff.
          </p>
        </div>
      </div>

      <h2 style={{
        margin: 0,
        fontFamily: "'VT323', monospace",
        fontSize: "1.65rem",
        color: "var(--forge-hot)",
      }}>
        Dashboard
      </h2>

      {visibleStatusMessage ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "0.5rem",
          alignItems: "start",
          fontSize: "0.82rem",
          color: "var(--forge-muted)",
          padding: "0.5rem 0.6rem",
          borderRadius: "6px",
          border: "1px solid rgba(127, 72, 43, 0.45)",
          background: "rgba(42, 52, 84, 0.35)",
        }}>
          <p style={{ margin: 0, overflowWrap: "anywhere", lineHeight: 1.35 }}>
            {visibleStatusMessage}
          </p>
          <button
            type="button"
            onClick={() => setStatusMessage("")}
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "6px",
              fontSize: "0.75rem",
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handleNewProject()}
        style={{ justifySelf: "start" }}
      >
        New Project
      </button>

      <section
        style={{
          display: "grid",
          gap: "0.45rem",
          border: "1px solid var(--forge-line)",
          borderRadius: "9px",
          background: "#0f1628",
          padding: "0.62rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <strong style={{ fontSize: "0.9rem", color: "var(--forge-ink)" }}>
            Active Runs
          </strong>
          <span style={{ fontSize: "0.75rem", color: "var(--forge-muted)" }}>
            {activeRuns.length} active
          </span>
        </div>

        {activeRuns.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "var(--forge-muted)",
            }}
          >
            No active runs right now.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {activeRuns.map((run) => {
              const status = ACTIVE_RUN_STYLES[run.status];
              return (
                <div
                  key={run.jobId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "0.55rem",
                    alignItems: "center",
                    border: "1px solid var(--forge-line)",
                    borderRadius: "8px",
                    padding: "0.5rem 0.55rem",
                    background: "#101a30",
                  }}
                >
                  <div style={{ display: "grid", gap: "0.15rem" }}>
                    <strong style={{ fontSize: "0.84rem" }}>
                      {run.projectName}
                    </strong>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.74rem",
                        color: "var(--forge-muted)",
                      }}
                    >
                      mode={run.executionMode} · {run.branch} · job {run.jobId}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.73rem",
                        color: "var(--forge-muted)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.08rem 0.35rem",
                          borderRadius: "999px",
                          border: `1px solid ${status.borderColor}`,
                          background: status.background,
                          color: status.color,
                          marginRight: "0.35rem",
                          fontWeight: 600,
                        }}
                      >
                        {status.label}
                      </span>
                      Updated: {formatUtcTimestamp(run.updatedAt)}
                    </p>
                  </div>
                  <a
                    href={`/projects/${run.projectId}/execute?jobId=${run.jobId}`}
                    style={{
                      display: "inline-block",
                      padding: "0.34rem 0.6rem",
                      borderRadius: "7px",
                      border: "1px solid #7f482b",
                      background:
                        "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
                      color: "var(--forge-ink)",
                      textDecoration: "none",
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      textAlign: "center",
                    }}
                  >
                    Open run
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {initialRepoGroups.length === 0 ? (
        <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.84rem" }}>
          No projects yet. Create one to start the connect → generate → execute flow.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.55rem" }}>
          {initialRepoGroups.map((group, index) => (
            <details
              key={group.repoKey}
              open={index === 0}
              style={{
                display: "grid",
                border: "1px solid var(--forge-line)",
                borderRadius: "9px",
                background: "#0f1628",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.56rem 0.62rem",
                  listStyle: "none",
                }}
              >
                <strong style={{ fontSize: "0.9rem" }}>{group.repoLabel}</strong>
                <span style={{ fontSize: "0.77rem", color: "var(--forge-muted)" }}>
                  {group.projectCount} project{group.projectCount === 1 ? "" : "s"} · {group.runCount} run
                  {group.runCount === 1 ? "" : "s"}
                </span>
              </summary>

              <div style={{ display: "grid", gap: "0.42rem", padding: "0 0.62rem 0.62rem" }}>
                {group.projects.map((project) => {
                  const outcome = OUTCOME_STYLES[project.latestRunOutcome];
                  const hasActiveRun = activeProjectIds.has(project.id);
                  return (
                    <div
                      key={project.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "center",
                        gap: "0.5rem",
                        border: "1px solid var(--forge-line)",
                        borderRadius: "8px",
                        padding: "0.52rem 0.56rem",
                        background: "#101a30",
                      }}
                    >
                      <div style={{ display: "grid", gap: "0.18rem" }}>
                        <strong style={{ fontSize: "0.87rem" }}>{project.name}</strong>
                        <p style={{ margin: 0, fontSize: "0.77rem", color: "var(--forge-muted)" }}>
                          {project.defaultBranch} · {project.runCount} run{project.runCount === 1 ? "" : "s"}
                        </p>
                        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--forge-muted)" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.08rem 0.35rem",
                              borderRadius: "999px",
                              border: `1px solid ${outcome.borderColor}`,
                              background: outcome.background,
                              color: outcome.color,
                              marginRight: "0.38rem",
                              fontWeight: 600,
                            }}
                          >
                            {outcome.label}
                          </span>
                          Last activity: {project.lastActivityLabel}
                        </p>
                      </div>
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <a
                          href={`/projects/${project.id}/connect`}
                          style={{
                            display: "inline-block",
                            padding: "0.38rem 0.65rem",
                            borderRadius: "7px",
                            border: "1px solid #7f482b",
                            background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
                            color: "var(--forge-ink)",
                            textDecoration: "none",
                            fontWeight: 600,
                            fontSize: "0.83rem",
                            textAlign: "center",
                          }}
                        >
                          Open
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleDeleteProjectRuns(project.id, project.name)}
                          disabled={Boolean(deletingProjectId) || hasActiveRun}
                          style={{
                            padding: "0.3rem 0.52rem",
                            borderRadius: "7px",
                            border: "1px solid var(--forge-line)",
                            background: "linear-gradient(180deg, #2d3654 0%, #222a44 100%)",
                            color: "var(--forge-muted)",
                            fontWeight: 600,
                            fontSize: "0.75rem",
                            minWidth: "84px",
                          }}
                          title={
                            hasActiveRun
                              ? "Wait for active run to finish before clearing history."
                              : "Delete previous runs for this project."
                          }
                        >
                          {deletingProjectId === project.id
                            ? "Deleting..."
                            : hasActiveRun
                              ? "Run active"
                              : "Delete runs"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      )}

    </section>
  );
};
