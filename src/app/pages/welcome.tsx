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
  installUrl: string;
}

type WizardStep = 1 | 2 | 3;

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
  const [activeStep, setActiveStep] = useState<WizardStep>(1);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [githubConnection, setGithubConnection] =
    useState<GitHubConnectionView | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Complete setup in order: sign in, connect GitHub, then create a project.",
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const lastSession = sessions[0] ?? null;
  const isSignedIn = Boolean(authPrincipal);
  const isGitHubConnected = Boolean(githubConnection);

  const setStepFromState = (
    principal: AuthPrincipal | null,
    connection: GitHubConnectionView | null,
  ) => {
    if (!principal) {
      setActiveStep(1);
      return;
    }

    if (!connection) {
      setActiveStep(2);
      return;
    }

    setActiveStep(3);
  };

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
      setStepFromState(null, null);
      return;
    }

    const [projectsRes, sessionsRes, githubConnectionRes, githubReposRes] =
      await Promise.all([
        fetch("/api/projects"),
        fetch("/api/codex/sessions"),
        fetch("/api/github/connection"),
        fetch("/api/github/repos"),
      ]);

    let nextProjects: Project[] = [];
    let nextConnection: GitHubConnectionView | null = null;

    if (projectsRes.ok) {
      const projectsJson = (await projectsRes.json()) as ProjectPayload;
      nextProjects = projectsJson.data || [];
      setProjects(nextProjects);

      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current)) {
          return current;
        }

        return nextProjects[0]?.id ?? "";
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
      nextConnection = githubConnectionJson.connection ?? null;
      setGithubConnection(nextConnection);
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

    setStepFromState(principal, nextConnection);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const githubStatus = url.searchParams.get("github");
    const githubError = url.searchParams.get("githubError");

    if (githubStatus === "connected") {
      setStatusMessage("GitHub App connected.");
    } else if (githubStatus === "error") {
      const readableError = githubError
        ? githubError.replace(/_/g, " ")
        : "unknown_error";
      setStatusMessage(`GitHub App connection failed (${readableError}).`);
    }

    if (githubStatus || githubError) {
      url.searchParams.delete("github");
      url.searchParams.delete("githubError");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

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
    await loadData();
    setStatusMessage("Signed out.");
    setActiveStep(1);
  };

  const handleInstallGitHubApp = async () => {
    if (!authPrincipal) {
      setStatusMessage("Sign in first to connect GitHub.");
      return;
    }

    const response = await fetch("/api/github/connect/start");

    if (!response.ok) {
      setStatusMessage(
        await readError(response, "Failed to prepare GitHub installation URL."),
      );
      return;
    }

    const payload = (await response.json()) as GitHubInstallPayload;
    setStatusMessage("Redirecting to GitHub App installation...");
    window.location.assign(payload.installUrl);
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
    setActiveStep(2);
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

  const goToStep = (step: WizardStep) => {
    if (step === 1) {
      setActiveStep(1);
      return;
    }

    if (step === 2 && isSignedIn) {
      setActiveStep(2);
      return;
    }

    if (step === 3 && isSignedIn && isGitHubConnected) {
      setActiveStep(3);
    }
  };

  const stepItems: Array<{
    id: WizardStep;
    title: string;
    unlocked: boolean;
    done: boolean;
  }> = [
    {
      id: 1,
      title: "Sign in",
      unlocked: true,
      done: isSignedIn,
    },
    {
      id: 2,
      title: "Connect GitHub",
      unlocked: isSignedIn,
      done: isGitHubConnected,
    },
    {
      id: 3,
      title: "Create project",
      unlocked: isSignedIn && isGitHubConnected,
      done: projects.length > 0,
    },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>ScenarioForge</p>
        <h1 className={styles.title}>Phase 1 Setup Wizard</h1>
        <p className={styles.subtitle}>
          One path, three steps: sign in, connect GitHub, create your project.
        </p>
      </section>

      <p className={styles.statusBanner}>{statusMessage}</p>

      <section className={styles.layout}>
        <nav className={`${styles.panel} ${styles.stepsPanel}`}>
          <h2>Setup Steps</h2>
          <div className={styles.stepList}>
            {stepItems.map((step) => {
              const stepState = step.done
                ? "Done"
                : step.id === activeStep
                  ? "Active"
                  : "Pending";

              return (
                <button
                  key={step.id}
                  type="button"
                  className={styles.stepButton}
                  onClick={() => goToStep(step.id)}
                  disabled={!step.unlocked}
                  data-active={step.id === activeStep}
                >
                  <span className={styles.stepNumber}>{step.id}</span>
                  <span className={styles.stepTitle}>{step.title}</span>
                  <span className={styles.stepState}>{stepState}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <article className={`${styles.panel} ${styles.stagePanel}`}>
          {activeStep === 1 ? (
            <section className={styles.section}>
              <h2>Step 1: Sign In</h2>
              {authPrincipal ? (
                <>
                  <p className={styles.hint}>
                    Signed in as <strong>{authPrincipal.displayName}</strong>
                    {authPrincipal.email ? ` (${authPrincipal.email})` : ""}.
                  </p>
                  <div className={styles.inlineActions}>
                    <button type="button" onClick={() => setActiveStep(2)}>
                      Continue to GitHub
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={handleSignOut}
                    >
                      Sign Out
                    </button>
                  </div>
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
          ) : null}

          {activeStep === 2 ? (
            <section className={styles.section}>
              <h2>Step 2: Connect GitHub</h2>
              {!authPrincipal ? (
                <p className={styles.hint}>Complete Step 1 first.</p>
              ) : (
                <>
                  <p className={styles.hint}>
                    {githubConnection
                      ? `Connected installation #${githubConnection.installationId}${
                          githubConnection.accountLogin
                            ? ` for ${githubConnection.accountLogin}`
                            : ""
                        }.`
                      : "Install the GitHub App. You will return here automatically and connect without entering an installation ID."}
                  </p>

                  <div className={styles.inlineActions}>
                    <button type="button" onClick={handleInstallGitHubApp}>
                      {githubConnection
                        ? "Reconnect GitHub App"
                        : "Install and Connect GitHub App"}
                    </button>
                    {githubConnection ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={handleDisconnectGitHub}
                      >
                        Disconnect
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={!githubConnection}
                    onClick={() => setActiveStep(3)}
                  >
                    Continue to Project Setup
                  </button>
                </>
              )}
            </section>
          ) : null}

          {activeStep === 3 ? (
            <section className={styles.section}>
              <h2>Step 3: Create Project</h2>
              {!authPrincipal || !githubConnection ? (
                <p className={styles.hint}>Complete Steps 1 and 2 first.</p>
              ) : (
                <>
                  <label className={styles.inlineLabel}>
                    Repository selection (optional prefill)
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
                </>
              )}
            </section>
          ) : null}
        </article>

        <aside className={`${styles.panel} ${styles.summaryPanel}`}>
          <h2>Workspace Snapshot</h2>
          <div className={styles.metaList}>
            <p>
              <strong>Owner:</strong> {authPrincipal?.displayName ?? "None"}
            </p>
            <p>
              <strong>GitHub:</strong>{" "}
              {githubConnection
                ? `Connected (#${githubConnection.installationId})`
                : "Not connected"}
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

          <details className={styles.advanced}>
            <summary>Advanced</summary>
            <p className={styles.hint}>
              Developer controls and debug payloads are tucked here.
            </p>

            <button type="button" onClick={handleStartSession} disabled={!selectedProjectId}>
              Initialize Codex Session
            </button>

            {lastSession ? (
              <div className={styles.codeGroup}>
                <h3>Latest Initialize Payload</h3>
                <pre>{JSON.stringify(lastSession.initializeRequest, null, 2)}</pre>
                <h3>Latest Thread Start Payload</h3>
                <pre>{JSON.stringify(lastSession.threadStartRequest, null, 2)}</pre>
              </div>
            ) : (
              <p className={styles.hint}>No session payloads yet.</p>
            )}
          </details>
        </aside>
      </section>
    </main>
  );
};
