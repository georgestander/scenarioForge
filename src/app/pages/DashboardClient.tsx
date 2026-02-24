"use client";

import { useState } from "react";
import type { Project } from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";

export const DashboardClient = ({
  initialProjects,
}: {
  initialProjects: Project[];
}) => {
  const { signOut, statusMessage, setStatusMessage } = useSession();
  const [projects, setProjects] = useState<Project[]>(initialProjects);

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
    setProjects((current) => [payload.project, ...current]);
    // Navigate directly to the connect page for the new project
    window.location.href = `/projects/${payload.project.id}/connect`;
  };

  return (
    <section style={{ display: "grid", gap: "0.75rem" }}>
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

      {projects.length === 0 ? (
        <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.84rem" }}>
          No projects yet. Click "New Project" to get started.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.42rem" }}>
          {projects.map((project) => (
            <div
              key={project.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: "0.5rem",
                border: "1px solid var(--forge-line)",
                borderRadius: "9px",
                padding: "0.58rem 0.6rem",
                background: "#0f1628",
              }}
            >
              <div>
                <strong style={{ fontSize: "0.9rem" }}>{project.name}</strong>
                <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                  {project.repoUrl ?? "No repo"} | {project.defaultBranch}
                </p>
              </div>
              <a
                href={`/projects/${project.id}/connect`}
                style={{
                  display: "inline-block",
                  padding: "0.4rem 0.7rem",
                  borderRadius: "7px",
                  border: "1px solid #7f482b",
                  background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
                  color: "var(--forge-ink)",
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textAlign: "center",
                }}
              >
                Open
              </a>
            </div>
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
