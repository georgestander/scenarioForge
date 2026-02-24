"use client";

import { useState } from "react";
import type { Project } from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";

const initialProjectForm = {
  name: "",
  repoUrl: "",
  defaultBranch: "main",
};

export const DashboardClient = ({
  initialProjects,
}: {
  initialProjects: Project[];
}) => {
  const { authPrincipal, signOut, statusMessage, setStatusMessage } = useSession();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [projectForm, setProjectForm] = useState(initialProjectForm);

  const handleProjectCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectForm.name.trim()) {
      setStatusMessage("Project name is required.");
      return;
    }

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectForm),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to create project."));
      return;
    }

    const payload = (await response.json()) as { project: Project };
    setProjectForm(initialProjectForm);
    setProjects((current) => [payload.project, ...current]);
    setStatusMessage(`Created project ${payload.project.name}.`);
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

      <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.84rem" }}>
        Signed in as <strong>{authPrincipal?.displayName ?? "Unknown"}</strong>
        {authPrincipal?.email ? ` (${authPrincipal.email})` : ""}.
      </p>

      <div style={{
        border: "1px solid var(--forge-line)",
        background: "var(--forge-panel)",
        borderRadius: "12px",
        padding: "0.8rem",
        boxShadow: "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
      }}>
        <h3 style={{
          margin: "0 0 0.5rem",
          fontFamily: "'VT323', monospace",
          fontSize: "1.28rem",
          color: "var(--forge-hot)",
        }}>
          New Project
        </h3>
        <form style={{ display: "grid", gap: "0.5rem" }} onSubmit={handleProjectCreate}>
          <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
            Project name
            <input
              value={projectForm.name}
              onChange={(e) => setProjectForm((c) => ({ ...c, name: e.target.value }))}
              placeholder="ScenarioForge"
            />
          </label>
          <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
            Repo URL
            <input
              value={projectForm.repoUrl}
              onChange={(e) => setProjectForm((c) => ({ ...c, repoUrl: e.target.value }))}
              placeholder="https://github.com/org/repo"
            />
          </label>
          <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
            Default branch
            <input
              value={projectForm.defaultBranch}
              onChange={(e) => setProjectForm((c) => ({ ...c, defaultBranch: e.target.value }))}
              placeholder="main"
            />
          </label>
          <button type="submit">Create Project</button>
        </form>
      </div>

      <div style={{
        border: "1px solid var(--forge-line)",
        background: "var(--forge-panel)",
        borderRadius: "12px",
        padding: "0.8rem",
        boxShadow: "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
      }}>
        <h3 style={{
          margin: "0 0 0.5rem",
          fontFamily: "'VT323', monospace",
          fontSize: "1.28rem",
          color: "var(--forge-hot)",
        }}>
          Projects
        </h3>
        {projects.length === 0 ? (
          <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.84rem" }}>
            No projects yet. Create one above.
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
      </div>

      <button
        type="button"
        onClick={() => void signOut().then(() => { window.location.href = "/"; })}
        style={{
          borderColor: "#3f557f",
          background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
        }}
      >
        Sign Out
      </button>
    </section>
  );
};
