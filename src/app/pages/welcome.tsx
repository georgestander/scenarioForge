"use client";

import { useEffect, useMemo, useState } from "react";
import type { CodexSession, Project } from "@/domain/models";
import styles from "./welcome.module.css";

interface ProjectPayload {
  data: Project[];
}

interface SessionPayload {
  data: CodexSession[];
}

const pillars = [
  "Select trusted sources before generation (PRD/specs/plans/code).",
  "Generate scenario packs grouped by feature and user outcome.",
  "Run scenarios with live progress, evidence, and traceable pass/fail criteria.",
  "Auto-fix failures with Codex and open review-ready pull requests.",
];

const initialProjectForm = {
  name: "",
  repoUrl: "",
  defaultBranch: "main",
};

export const Welcome = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [projectForm, setProjectForm] = useState(initialProjectForm);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Phase 0 ready: create a project to bootstrap Codex session scaffolding.",
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const lastSession = sessions[0] ?? null;

  const loadData = async () => {
    const [projectsRes, sessionsRes] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/codex/sessions"),
    ]);

    const projectsJson = (await projectsRes.json()) as ProjectPayload;
    const sessionsJson = (await sessionsRes.json()) as SessionPayload;

    setProjects(projectsJson.data || []);
    setSessions(sessionsJson.data || []);

    if (!selectedProjectId && projectsJson.data?.length) {
      setSelectedProjectId(projectsJson.data[0].id);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleProjectCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectForm.name.trim()) {
      setStatusMessage("Project name is required.");
      return;
    }

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(projectForm),
    });

    if (!response.ok) {
      setStatusMessage("Failed to create project.");
      return;
    }

    const json = (await response.json()) as { project: Project };

    setProjectForm(initialProjectForm);
    setSelectedProjectId(json.project.id);
    setStatusMessage(`Created project ${json.project.name}.`);
    await loadData();
  };

  const handleStartSession = async () => {
    if (!selectedProjectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const response = await fetch("/api/codex/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ projectId: selectedProjectId }),
    });

    if (!response.ok) {
      setStatusMessage("Failed to start Codex session.");
      return;
    }

    await loadData();
    setStatusMessage("Codex session skeleton initialized.");
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Codex Challenge Build</p>
        <h1 className={styles.title}>ScenarioForge</h1>
        <p className={styles.subtitle}>
          Scenario-first collaboration platform with a live project shell for Phase 0.
        </p>
      </section>

      <section className={styles.visualCard}>
        <img
          className={styles.heroImage}
          src="/scenario-forge.png"
          alt="ScenarioForge brand art showing a forge"
        />
      </section>

      <section className={styles.contentGrid}>
        <article className={styles.panel}>
          <h2>Core Capabilities</h2>
          <ul>
            {pillars.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className={styles.panel}>
          <h2>Phase 0 Shell</h2>
          <p className={styles.status}>{statusMessage}</p>

          <form className={styles.form} onSubmit={handleProjectCreate}>
            <label>
              Project name
              <input
                value={projectForm.name}
                onChange={(event) =>
                  setProjectForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="ScenarioForge"
              />
            </label>

            <label>
              Repo URL
              <input
                value={projectForm.repoUrl}
                onChange={(event) =>
                  setProjectForm((current) => ({
                    ...current,
                    repoUrl: event.target.value,
                  }))
                }
                placeholder="https://github.com/org/repo"
              />
            </label>

            <label>
              Default branch
              <input
                value={projectForm.defaultBranch}
                onChange={(event) =>
                  setProjectForm((current) => ({
                    ...current,
                    defaultBranch: event.target.value,
                  }))
                }
                placeholder="main"
              />
            </label>

            <button type="submit">Create Project</button>
          </form>

          <div className={styles.separator} />

          <label className={styles.inlineLabel}>
            Active project
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <button onClick={handleStartSession} disabled={!selectedProjectId}>
            Initialize Codex Session
          </button>

          <div className={styles.metaList}>
            <p>
              <strong>Projects:</strong> {projects.length}
            </p>
            <p>
              <strong>Sessions:</strong> {sessions.length}
            </p>
            <p>
              <strong>Selected:</strong> {activeProject?.name ?? "None"}
            </p>
          </div>

          {lastSession ? (
            <div className={styles.codeGroup}>
              <h3>Latest Initialize Payload</h3>
              <pre>{JSON.stringify(lastSession.initializeRequest, null, 2)}</pre>
              <h3>Latest Thread Start Payload</h3>
              <pre>{JSON.stringify(lastSession.threadStartRequest, null, 2)}</pre>
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
};
