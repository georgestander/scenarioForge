"use client";

import type { Project } from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type {
  DashboardLatestRunOutcome,
  DashboardRepoGroup,
} from "./dashboardModels";

const OUTCOME_STYLES: Record<
  DashboardLatestRunOutcome,
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

export const DashboardClient = ({
  initialRepoGroups,
}: {
  initialRepoGroups: DashboardRepoGroup[];
}) => {
  const { signOut, statusMessage, setStatusMessage } = useSession();

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
          alt="ScenarioForge mission control"
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
            ScenarioForge Mission Control
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

      {statusMessage ? (
        <p style={{
          margin: 0,
          fontSize: "0.85rem",
          color: "var(--forge-muted)",
          padding: "0.45rem 0.6rem",
          borderRadius: "6px",
          background: "rgba(42, 52, 84, 0.4)",
        }}>
          {statusMessage}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleNewProject()}
        style={{ justifySelf: "start" }}
      >
        New Project
      </button>

      {initialRepoGroups.length === 0 ? (
        <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.84rem" }}>
          No run history yet. Projects appear here after their first execute run.
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
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void signOut().then(() => { window.location.href = "/"; })}
        style={{
          justifySelf: "start",
          borderColor: "#3f557f",
          background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
        }}
      >
        Sign Out
      </button>
    </section>
  );
};
