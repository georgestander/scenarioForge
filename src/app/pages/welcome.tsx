"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AuthPrincipal,
  CodexSession,
  GitHubRepository,
  Project,
} from "@/domain/models";
import styles from "./welcome.module.css";

interface ProjectPayload {
  data: Project[];
}

interface SessionPayload {
  data: CodexSession[];
}

interface AuthSessionPayload {
  authenticated: boolean;
  principal: AuthPrincipal | null;
}

interface GitHubConnectionView {
  id: string;
  principalId: string;
  provider: "github_app";
  status: "connected" | "disconnected";
  accountLogin: string | null;
  installationId: number;
  accessTokenExpiresAt: string | null;
  repositories: GitHubRepository[];
  createdAt: string;
  updatedAt: string;
}

interface GitHubConnectionPayload {
  connection: GitHubConnectionView | null;
}

interface GitHubReposPayload {
  data: GitHubRepository[];
}

interface GitHubInstallPayload {
  state: string;
  installUrl: string;
}

const pillars = [
  "Sign in with ChatGPT and scope every action to the current owner.",
  "Connect a GitHub App installation and pull repositories for selection.",
  "Select trusted sources before generation (PRD/specs/plans/code).",
  "Generate, run, auto-fix, and review with evidence-linked scenario traces.",
];

const initialProjectForm = {
  name: "",
  repoUrl: "",
  defaultBranch: "main",
};

const initialSignInForm = {
  displayName: "",
  email: "",
};

const readError = async (
  response: Response,
  fallbackMessage: string,
): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

export const Welcome = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [authPrincipal, setAuthPrincipal] = useState<AuthPrincipal | null>(null);
  const [projectForm, setProjectForm] = useState(initialProjectForm);
  const [signInForm, setSignInForm] = useState(initialSignInForm);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [githubConnection, setGithubConnection] =
    useState<GitHubConnectionView | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [githubInstallationId, setGithubInstallationId] = useState("");
  const [githubInstallUrl, setGithubInstallUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Phase 1 ready: sign in, connect GitHub App, then create owned projects and sessions.",
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const lastSession = sessions[0] ?? null;

  const loadData = async () => {
    const authRes = await fetch("/api/auth/session");

    if (!authRes.ok) {
      setStatusMessage("Unable to load auth session status.");
      return;
    }

    const authJson = (await authRes.json()) as AuthSessionPayload;
    const principal = authJson.principal ?? null;

    setAuthPrincipal(principal);

    if (!authJson.authenticated || !principal) {
      setProjects([]);
      setSessions([]);
      setGithubConnection(null);
      setGithubRepos([]);
      setSelectedProjectId("");
      setSelectedRepoId("");
      return;
    }

    const [projectsRes, sessionsRes, githubConnectionRes, githubReposRes] =
      await Promise.all([
        fetch("/api/projects"),
        fetch("/api/codex/sessions"),
        fetch("/api/github/connection"),
        fetch("/api/github/repos"),
      ]);

    if (projectsRes.ok) {
      const projectsJson = (await projectsRes.json()) as ProjectPayload;
      const projectData = projectsJson.data || [];
      setProjects(projectData);

      setSelectedProjectId((current) => {
        if (current && projectData.some((project) => project.id === current)) {
          return current;
        }

        return projectData[0]?.id ?? "";
      });
    } else {
      setProjects([]);
      setSelectedProjectId("");
    }

    if (sessionsRes.ok) {
      const sessionsJson = (await sessionsRes.json()) as SessionPayload;
      setSessions(sessionsJson.data || []);
    } else {
      setSessions([]);
    }

    if (githubConnectionRes.ok) {
      const githubConnectionJson =
        (await githubConnectionRes.json()) as GitHubConnectionPayload;
      setGithubConnection(githubConnectionJson.connection ?? null);
    } else {
      setGithubConnection(null);
    }

    if (githubReposRes.ok) {
      const githubReposJson = (await githubReposRes.json()) as GitHubReposPayload;
      const repos = githubReposJson.data ?? [];
      setGithubRepos(repos);
      setSelectedRepoId((current) => {
        if (current && repos.some((repo) => String(repo.id) === current)) {
          return current;
        }

        return "";
      });
    } else {
      setGithubRepos([]);
      setSelectedRepoId("");
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const response = await fetch("/api/auth/chatgpt/sign-in", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(signInForm),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to sign in."));
      return;
    }

    setSignInForm(initialSignInForm);
    await loadData();
    setStatusMessage("ChatGPT sign-in complete.");
  };

  const handleSignOut = async () => {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to sign out."));
      return;
    }

    setProjectForm(initialProjectForm);
    setGithubInstallationId("");
    setGithubInstallUrl("");
    await loadData();
    setStatusMessage("Signed out.");
  };

  const handleBuildInstallUrl = async () => {
    const response = await fetch("/api/github/connect/start");

    if (!response.ok) {
      setStatusMessage(
        await readError(response, "Failed to prepare GitHub installation URL."),
      );
      return;
    }

    const payload = (await response.json()) as GitHubInstallPayload;
    setGithubInstallUrl(payload.installUrl);
    setStatusMessage("GitHub installation URL generated.");
  };

  const handleConnectGitHub = async () => {
    const installationId = Number(githubInstallationId);

    if (!Number.isInteger(installationId) || installationId <= 0) {
      setStatusMessage("Installation ID must be a positive integer.");
      return;
    }

    const response = await fetch("/api/github/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ installationId }),
    });

    if (!response.ok) {
      setStatusMessage(
        await readError(response, "Failed to connect GitHub installation."),
      );
      return;
    }

    await loadData();
    setStatusMessage("GitHub App connected.");
  };

  const handleDisconnectGitHub = async () => {
    const response = await fetch("/api/github/disconnect", {
      method: "POST",
    });

    if (!response.ok) {
      setStatusMessage(
        await readError(response, "Failed to disconnect GitHub installation."),
      );
      return;
    }

    await loadData();
    setStatusMessage("GitHub App disconnected.");
  };

  const handleRepoSelect = (repoId: string) => {
    setSelectedRepoId(repoId);

    const selectedRepo = githubRepos.find((repo) => String(repo.id) === repoId);

    if (!selectedRepo) {
      return;
    }

    setProjectForm((current) => ({
      ...current,
      name: current.name || selectedRepo.name,
      repoUrl: selectedRepo.url,
      defaultBranch: selectedRepo.defaultBranch || "main",
    }));
  };

  const handleProjectCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authPrincipal) {
      setStatusMessage("Sign in with ChatGPT before creating a project.");
      return;
    }

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
      setStatusMessage(await readError(response, "Failed to create project."));
      return;
    }

    const json = (await response.json()) as { project: Project };

    setProjectForm(initialProjectForm);
    setSelectedProjectId(json.project.id);
    setStatusMessage(`Created project ${json.project.name}.`);
    await loadData();
  };

  const handleStartSession = async () => {
    if (!authPrincipal) {
      setStatusMessage("Sign in with ChatGPT before starting a session.");
      return;
    }

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
      setStatusMessage(await readError(response, "Failed to start Codex session."));
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
          Scenario-first collaboration platform with Phase 1 auth, ownership, and
          GitHub App connect scaffolding.
        </p>
      </section>

      <section className={styles.visualCard}>
        <img
          className={styles.heroImage}
          src="/scenarioForge.png"
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
          <h2>Phase 1 Shell</h2>
          <p className={styles.status}>{statusMessage}</p>

          <section className={styles.section}>
            <h3>1. ChatGPT Sign-in</h3>
            {authPrincipal ? (
              <>
                <p className={styles.hint}>
                  Signed in as <strong>{authPrincipal.displayName}</strong>
                  {authPrincipal.email ? ` (${authPrincipal.email})` : ""}
                </p>
                <button onClick={handleSignOut}>Sign Out</button>
              </>
            ) : (
              <form className={styles.form} onSubmit={handleSignIn}>
                <label>
                  Display name
                  <input
                    value={signInForm.displayName}
                    onChange={(event) =>
                      setSignInForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    placeholder="ScenarioForge Builder"
                  />
                </label>

                <label>
                  Email (optional)
                  <input
                    value={signInForm.email}
                    onChange={(event) =>
                      setSignInForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="builder@example.com"
                  />
                </label>

                <button type="submit">Sign In With ChatGPT</button>
              </form>
            )}
          </section>

          <div className={styles.separator} />

          <section className={styles.section}>
            <h3>2. GitHub App Connection</h3>
            {!authPrincipal ? (
              <p className={styles.hint}>Sign in first to connect GitHub.</p>
            ) : (
              <>
                <p className={styles.hint}>
                  {githubConnection
                    ? `Connected installation #${githubConnection.installationId}${
                        githubConnection.accountLogin
                          ? ` for ${githubConnection.accountLogin}`
                          : ""
                      }.`
                    : "No GitHub installation connected yet."}
                </p>

                <div className={styles.inlineActions}>
                  <button onClick={handleBuildInstallUrl}>Get Install URL</button>
                  {githubConnection ? (
                    <button onClick={handleDisconnectGitHub}>Disconnect</button>
                  ) : null}
                </div>

                {githubInstallUrl ? (
                  <p className={styles.linkRow}>
                    <a href={githubInstallUrl} target="_blank" rel="noreferrer">
                      Open GitHub App installation flow
                    </a>
                  </p>
                ) : null}

                <label>
                  Installation ID
                  <input
                    value={githubInstallationId}
                    onChange={(event) => setGithubInstallationId(event.target.value)}
                    placeholder="12345678"
                  />
                </label>

                <button onClick={handleConnectGitHub}>Connect Installation</button>

                <label className={styles.inlineLabel}>
                  Repository selection
                  <select
                    value={selectedRepoId}
                    onChange={(event) => handleRepoSelect(event.target.value)}
                  >
                    <option value="">Select a repository</option>
                    {githubRepos.map((repo) => (
                      <option key={repo.id} value={String(repo.id)}>
                        {repo.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </section>

          <div className={styles.separator} />

          <section className={styles.section}>
            <h3>3. Owned Project + Codex Session</h3>
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
                  disabled={!authPrincipal}
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
                  disabled={!authPrincipal}
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
                  disabled={!authPrincipal}
                />
              </label>

              <button type="submit" disabled={!authPrincipal}>
                Create Project
              </button>
            </form>

            <label className={styles.inlineLabel}>
              Active project
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                disabled={!authPrincipal}
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
                <strong>Owner:</strong> {authPrincipal?.displayName ?? "None"}
              </p>
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
          </section>

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
