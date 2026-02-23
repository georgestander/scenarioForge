"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AuthPrincipal,
  CodexSession,
  FixAttempt,
  GitHubRepository,
  Project,
  PullRequestRecord,
  ReviewBoard,
  ScenarioPack,
  ScenarioRun,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import styles from "./welcome.module.css";

interface CollectionPayload<T> {
  data: T[];
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

interface GitHubInstallPayload {
  alreadyConnected?: boolean;
  installUrl?: string;
  manageUrl?: string;
}

interface ManifestCreatePayload {
  manifest: SourceManifest;
  selectedSources: SourceRecord[];
  includesStale: boolean;
}

interface ScenarioPackCreatePayload {
  pack: ScenarioPack;
}

interface ScenarioRunCreatePayload {
  run: ScenarioRun;
}

interface FixAttemptCreatePayload {
  fixAttempt: FixAttempt;
}

interface PullRequestCreatePayload {
  pullRequest: PullRequestRecord;
}

interface ReviewBoardPayload {
  board: ReviewBoard;
}

interface ReviewReportPayload {
  markdown: string;
}

type Stage = 1 | 2 | 3 | 4 | 5 | 6;

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

const stageTitle = (stage: Stage): string => {
  switch (stage) {
    case 1:
      return "Connect";
    case 2:
      return "Select Sources";
    case 3:
      return "Generate";
    case 4:
      return "Run";
    case 5:
      return "Auto-Fix";
    case 6:
      return "Review";
  }
};

export const Welcome = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [authPrincipal, setAuthPrincipal] = useState<AuthPrincipal | null>(null);
  const [githubConnection, setGithubConnection] =
    useState<GitHubConnectionView | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectForm, setProjectForm] = useState(initialProjectForm);
  const [signInForm, setSignInForm] = useState(initialSignInForm);

  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [manifests, setManifests] = useState<SourceManifest[]>([]);
  const [confirmationNote, setConfirmationNote] = useState(
    "Confirmed against current product direction.",
  );
  const [includeStaleConfirmed, setIncludeStaleConfirmed] = useState(false);

  const [scenarioPacks, setScenarioPacks] = useState<ScenarioPack[]>([]);
  const [selectedScenarioPackId, setSelectedScenarioPackId] = useState("");
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRun[]>([]);
  const [liveEvents, setLiveEvents] = useState<ScenarioRun["events"]>([]);
  const [fixAttempts, setFixAttempts] = useState<FixAttempt[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [reviewBoard, setReviewBoard] = useState<ReviewBoard | null>(null);
  const [reviewReport, setReviewReport] = useState("");

  const [activeStage, setActiveStage] = useState<Stage>(1);
  const [statusMessage, setStatusMessage] = useState(
    "Follow the mission sequence: connect -> select -> generate -> run -> fix -> review.",
  );

  const isSignedIn = Boolean(authPrincipal);
  const isGitHubConnected = Boolean(githubConnection);
  const hasProject = Boolean(selectedProjectId);
  const latestManifest = manifests[0] ?? null;
  const latestPack = scenarioPacks[0] ?? null;
  const latestRun = scenarioRuns[0] ?? null;
  const latestFixAttempt = fixAttempts[0] ?? null;

  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const selectedPack =
    scenarioPacks.find((pack) => pack.id === selectedScenarioPackId) ??
    latestPack ??
    null;

  const staleSelectedCount = useMemo(
    () =>
      sources.filter(
        (source) => selectedSourceIds.includes(source.id) && source.status === "stale",
      ).length,
    [sources, selectedSourceIds],
  );

  const stageUnlocked: Record<Stage, boolean> = {
    1: true,
    2: isSignedIn && isGitHubConnected && hasProject,
    3: Boolean(latestManifest),
    4: Boolean(latestPack),
    5: Boolean(latestRun),
    6: fixAttempts.length > 0 || pullRequests.length > 0,
  };

  const stageDone: Record<Stage, boolean> = {
    1: isSignedIn && isGitHubConnected && hasProject,
    2: Boolean(latestManifest),
    3: scenarioPacks.length > 0,
    4: scenarioRuns.length > 0,
    5: fixAttempts.length > 0,
    6: Boolean(reviewBoard),
  };

  const ensureActiveStage = () => {
    if (!stageUnlocked[2]) {
      setActiveStage(1);
      return;
    }
    if (!stageUnlocked[3]) {
      setActiveStage(2);
      return;
    }
    if (!stageUnlocked[4]) {
      setActiveStage(3);
      return;
    }
    if (!stageUnlocked[5]) {
      setActiveStage(4);
      return;
    }
    if (!stageUnlocked[6]) {
      setActiveStage(5);
      return;
    }
    setActiveStage(6);
  };

  const loadProjectData = async (projectId: string) => {
    const [sourcesRes, manifestsRes, packsRes, runsRes, fixRes, prsRes, boardRes] =
      await Promise.all([
        fetch(`/api/projects/${projectId}/sources`),
        fetch(`/api/projects/${projectId}/source-manifests`),
        fetch(`/api/projects/${projectId}/scenario-packs`),
        fetch(`/api/projects/${projectId}/scenario-runs`),
        fetch(`/api/projects/${projectId}/fix-attempts`),
        fetch(`/api/projects/${projectId}/pull-requests`),
        fetch(`/api/projects/${projectId}/review-board`),
      ]);

    if (sourcesRes.ok) {
      const payload = (await sourcesRes.json()) as CollectionPayload<SourceRecord>;
      setSources(payload.data ?? []);
      setSelectedSourceIds(
        (payload.data ?? []).filter((item) => item.selected).map((item) => item.id),
      );
    } else {
      setSources([]);
      setSelectedSourceIds([]);
    }

    if (manifestsRes.ok) {
      const payload = (await manifestsRes.json()) as CollectionPayload<SourceManifest>;
      setManifests(payload.data ?? []);
    } else {
      setManifests([]);
    }

    if (packsRes.ok) {
      const payload = (await packsRes.json()) as CollectionPayload<ScenarioPack>;
      const packs = payload.data ?? [];
      setScenarioPacks(packs);
      setSelectedScenarioPackId((current) => {
        if (current && packs.some((pack) => pack.id === current)) {
          return current;
        }
        return packs[0]?.id ?? "";
      });
    } else {
      setScenarioPacks([]);
      setSelectedScenarioPackId("");
    }

    if (runsRes.ok) {
      const payload = (await runsRes.json()) as CollectionPayload<ScenarioRun>;
      setScenarioRuns(payload.data ?? []);
    } else {
      setScenarioRuns([]);
    }

    if (fixRes.ok) {
      const payload = (await fixRes.json()) as CollectionPayload<FixAttempt>;
      setFixAttempts(payload.data ?? []);
    } else {
      setFixAttempts([]);
    }

    if (prsRes.ok) {
      const payload = (await prsRes.json()) as CollectionPayload<PullRequestRecord>;
      setPullRequests(payload.data ?? []);
    } else {
      setPullRequests([]);
    }

    if (boardRes.ok) {
      const payload = (await boardRes.json()) as ReviewBoardPayload;
      setReviewBoard(payload.board);
    } else {
      setReviewBoard(null);
    }
  };

  const loadBaseData = async () => {
    const authRes = await fetch("/api/auth/session");

    if (!authRes.ok) {
      setStatusMessage("Unable to load auth session state.");
      return;
    }

    const authPayload = (await authRes.json()) as AuthSessionPayload;
    const principal = authPayload.principal ?? null;
    setAuthPrincipal(principal);

    if (!principal) {
      setProjects([]);
      setSessions([]);
      setGithubConnection(null);
      setGithubRepos([]);
      setSelectedProjectId("");
      setSources([]);
      setManifests([]);
      setScenarioPacks([]);
      setScenarioRuns([]);
      setFixAttempts([]);
      setPullRequests([]);
      setReviewBoard(null);
      setReviewReport("");
      setActiveStage(1);
      return;
    }

    const [projectRes, sessionRes, githubConnectionRes, githubReposRes] =
      await Promise.all([
        fetch("/api/projects"),
        fetch("/api/codex/sessions"),
        fetch("/api/github/connection"),
        fetch("/api/github/repos"),
      ]);

    let nextProjects: Project[] = [];
    if (projectRes.ok) {
      const payload = (await projectRes.json()) as CollectionPayload<Project>;
      nextProjects = payload.data ?? [];
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

    if (sessionRes.ok) {
      const payload = (await sessionRes.json()) as CollectionPayload<CodexSession>;
      setSessions(payload.data ?? []);
    } else {
      setSessions([]);
    }

    if (githubConnectionRes.ok) {
      const payload = (await githubConnectionRes.json()) as GitHubConnectionPayload;
      setGithubConnection(payload.connection ?? null);
    } else {
      setGithubConnection(null);
    }

    if (githubReposRes.ok) {
      const payload = (await githubReposRes.json()) as CollectionPayload<GitHubRepository>;
      setGithubRepos(payload.data ?? []);
    } else {
      setGithubRepos([]);
    }

    if (nextProjects[0]) {
      await loadProjectData(nextProjects[0].id);
    }

    ensureActiveStage();
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const githubStatus = url.searchParams.get("github");
    const githubError = url.searchParams.get("githubError");

    if (githubStatus === "connected") {
      setStatusMessage("GitHub App connected successfully.");
    }
    if (githubStatus === "error") {
      const readable = githubError ? githubError.replace(/_/g, " ") : "unknown error";
      setStatusMessage(`GitHub App connection failed (${readable}).`);
    }

    if (githubStatus || githubError) {
      url.searchParams.delete("github");
      url.searchParams.delete("githubError");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    void loadBaseData();
  }, []);

  useEffect(() => {
    if (!authPrincipal || !selectedProjectId) {
      return;
    }

    void loadProjectData(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    ensureActiveStage();
  }, [
    isSignedIn,
    isGitHubConnected,
    hasProject,
    latestManifest,
    latestPack,
    latestRun,
    fixAttempts.length,
    pullRequests.length,
  ]);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const response = await fetch("/api/auth/chatgpt/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signInForm),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to sign in."));
      return;
    }

    setSignInForm(initialSignInForm);
    await loadBaseData();
    setStatusMessage("ChatGPT sign-in complete.");
  };

  const handleSignOut = async () => {
    const response = await fetch("/api/auth/sign-out", { method: "POST" });
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to sign out."));
      return;
    }

    setProjectForm(initialProjectForm);
    await loadBaseData();
    setStatusMessage("Signed out.");
  };

  const openInNewTab = (url: string): void => {
    const newWindow = window.open(url, "_blank", "noopener,noreferrer");

    if (!newWindow) {
      setStatusMessage(
        "Pop-up blocked. Allow pop-ups for this site and retry opening GitHub in a new tab.",
      );
    }
  };

  const handleInstallGitHubApp = async (forceReconnect = false) => {
    if (!authPrincipal) {
      setStatusMessage("Sign in first to connect GitHub.");
      return;
    }

    const suffix = forceReconnect ? "?force=1" : "";
    const response = await fetch(`/api/github/connect/start${suffix}`);
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to start GitHub connect."));
      return;
    }

    const payload = (await response.json()) as GitHubInstallPayload;

    if (payload.alreadyConnected && payload.manageUrl) {
      setStatusMessage("GitHub already connected. Opening installation settings in a new tab.");
      openInNewTab(payload.manageUrl);
      return;
    }

    if (!payload.installUrl) {
      setStatusMessage("Unable to find GitHub installation URL.");
      return;
    }

    setStatusMessage("Opening GitHub App installation in a new tab...");
    openInNewTab(payload.installUrl);
  };

  const handleDisconnectGitHub = async () => {
    const response = await fetch("/api/github/disconnect", { method: "POST" });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to disconnect GitHub."));
      return;
    }

    await loadBaseData();
    setStatusMessage("GitHub App disconnected.");
  };

  const handleRepoSelect = (repoId: string) => {
    setSelectedRepoId(repoId);
    const repo = githubRepos.find((item) => String(item.id) === repoId);
    if (!repo) {
      return;
    }

    setProjectForm((current) => ({
      ...current,
      name: current.name || repo.name,
      repoUrl: repo.url,
      defaultBranch: repo.defaultBranch || "main",
    }));
  };

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
    setSelectedProjectId(payload.project.id);
    await loadBaseData();
    setStatusMessage(`Created project ${payload.project.name}.`);
  };

  const handleStartSession = async () => {
    if (!selectedProjectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const response = await fetch("/api/codex/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProjectId }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to initialize Codex session."));
      return;
    }

    await loadBaseData();
    setStatusMessage("Codex session initialized.");
  };

  const handleScanSources = async () => {
    if (!selectedProjectId) {
      setStatusMessage("Create or select a project first.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/sources/scan`, {
      method: "POST",
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to scan sources."));
      return;
    }

    const payload = (await response.json()) as CollectionPayload<SourceRecord>;
    const scanned = payload.data ?? [];
    setSources(scanned);
    setSelectedSourceIds(
      scanned.filter((source) => source.selected).map((source) => source.id),
    );
    setStatusMessage(`Scanned ${scanned.length} sources. Review trust statuses.`);
  };

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  };

  const handleConfirmManifest = async () => {
    if (!selectedProjectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    if (selectedSourceIds.length === 0) {
      setStatusMessage("Select at least one source.");
      return;
    }

    if (staleSelectedCount > 0 && !includeStaleConfirmed) {
      setStatusMessage(
        "Selected sources include stale entries. Check the explicit confirmation toggle before continuing.",
      );
      return;
    }

    const response = await fetch(
      `/api/projects/${selectedProjectId}/source-manifests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: selectedSourceIds,
          userConfirmed: true,
          confirmationNote,
        }),
      },
    );

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to create source manifest."));
      return;
    }

    const payload = (await response.json()) as ManifestCreatePayload;
    setManifests((current) => [payload.manifest, ...current]);
    setSources((current) =>
      current.map((source) => ({
        ...source,
        selected: selectedSourceIds.includes(source.id),
      })),
    );
    setStatusMessage(
      `Source manifest ${payload.manifest.id} confirmed. Proceed to generation.`,
    );
  };

  const handleGenerateScenarios = async () => {
    if (!selectedProjectId || !latestManifest) {
      setStatusMessage("Confirm source manifest before generation.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/scenario-packs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifestId: latestManifest.id }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to generate scenarios."));
      return;
    }

    const payload = (await response.json()) as ScenarioPackCreatePayload;
    setScenarioPacks((current) => [payload.pack, ...current]);
    setSelectedScenarioPackId(payload.pack.id);
    setStatusMessage(
      `Generated ${payload.pack.scenarios.length} scenarios grouped by feature and outcome.`,
    );
  };

  const handleRunScenarios = async () => {
    if (!selectedProjectId || !selectedPack) {
      setStatusMessage("Generate and select a scenario pack first.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/scenario-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioPackId: selectedPack.id,
        scenarioIds: selectedPack.scenarios.map((scenario) => scenario.id),
      }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to run scenarios."));
      return;
    }

    const payload = (await response.json()) as ScenarioRunCreatePayload;
    setScenarioRuns((current) => [payload.run, ...current]);
    setLiveEvents([]);
    payload.run.events.forEach((event, index) => {
      window.setTimeout(() => {
        setLiveEvents((current) => [...current, event]);
      }, index * 220);
    });
    setStatusMessage(
      `Run ${payload.run.id} completed: ${payload.run.summary.passed} passed, ${payload.run.summary.failed} failed, ${payload.run.summary.blocked} blocked.`,
    );
  };

  const handleAutoFix = async () => {
    if (!selectedProjectId || !latestRun) {
      setStatusMessage("Run scenarios first.");
      return;
    }

    const failedCount = latestRun.items.filter((item) => item.status === "failed").length;
    if (failedCount === 0) {
      setStatusMessage("No failed scenarios in latest run.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/fix-attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: latestRun.id }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to create fix attempt."));
      return;
    }

    const payload = (await response.json()) as FixAttemptCreatePayload;
    setFixAttempts((current) => [payload.fixAttempt, ...current]);
    setStatusMessage(
      `Fix attempt ${payload.fixAttempt.id} prepared for ${payload.fixAttempt.failedScenarioIds.length} failed scenarios.`,
    );
  };

  const handleCreatePullRequest = async () => {
    if (!selectedProjectId || !latestFixAttempt) {
      setStatusMessage("Create a fix attempt first.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/pull-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixAttemptId: latestFixAttempt.id }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to create PR record."));
      return;
    }

    const payload = (await response.json()) as PullRequestCreatePayload;
    setPullRequests((current) => [payload.pullRequest, ...current]);
    setStatusMessage(`PR record created: ${payload.pullRequest.title}`);
  };

  const handleRefreshReviewBoard = async () => {
    if (!selectedProjectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/review-board`);
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to load review board."));
      return;
    }

    const payload = (await response.json()) as ReviewBoardPayload;
    setReviewBoard(payload.board);
    setStatusMessage("Review board refreshed.");
  };

  const handleExportReport = async () => {
    if (!selectedProjectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const response = await fetch(`/api/projects/${selectedProjectId}/review-report`);
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to export report."));
      return;
    }

    const payload = (await response.json()) as ReviewReportPayload;
    setReviewReport(payload.markdown);
    setStatusMessage("Challenge report exported.");
  };

  const stageCards: Array<{ id: Stage; locked: boolean; done: boolean }> = [
    { id: 1, locked: !stageUnlocked[1], done: stageDone[1] },
    { id: 2, locked: !stageUnlocked[2], done: stageDone[2] },
    { id: 3, locked: !stageUnlocked[3], done: stageDone[3] },
    { id: 4, locked: !stageUnlocked[4], done: stageDone[4] },
    { id: 5, locked: !stageUnlocked[5], done: stageDone[5] },
    { id: 6, locked: !stageUnlocked[6], done: stageDone[6] },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>ScenarioForge</p>
        <h1 className={styles.title}>Phase 2-6 Mission Control</h1>
        <p className={styles.subtitle}>
          Linear execution loop: connect -&gt; select -&gt; generate -&gt; run -&gt; fix -&gt; review.
        </p>
      </section>

      <p className={styles.statusBanner}>{statusMessage}</p>

      <section className={styles.layout}>
        <nav className={`${styles.panel} ${styles.stepsPanel}`}>
          <h2>Phases</h2>
          <div className={styles.stepList}>
            {stageCards.map((card) => {
              const state = card.done
                ? "Done"
                : activeStage === card.id
                  ? "Active"
                  : card.locked
                    ? "Locked"
                    : "Ready";

              return (
                <button
                  key={card.id}
                  type="button"
                  className={styles.stepButton}
                  data-active={activeStage === card.id}
                  disabled={card.locked}
                  onClick={() => setActiveStage(card.id)}
                >
                  <span className={styles.stepNumber}>{card.id}</span>
                  <span className={styles.stepTitle}>{stageTitle(card.id)}</span>
                  <span className={styles.stepState}>{state}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <article className={`${styles.panel} ${styles.stagePanel}`}>
          {activeStage === 1 ? (
            <section className={styles.section}>
              <h2>Stage 1: Connect Workspace</h2>
              <p className={styles.hint}>
                Sign in, connect GitHub, create/select project, and initialize Codex session.
              </p>

              {authPrincipal ? (
                <p className={styles.hint}>
                  Signed in as <strong>{authPrincipal.displayName}</strong>
                  {authPrincipal.email ? ` (${authPrincipal.email})` : ""}.
                </p>
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

              <div className={styles.inlineActions}>
                <button
                  type="button"
                  onClick={() => handleInstallGitHubApp(false)}
                  disabled={!isSignedIn}
                >
                  {isGitHubConnected ? "Open GitHub Installation" : "Connect GitHub"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleDisconnectGitHub}
                  disabled={!isGitHubConnected}
                >
                  Disconnect GitHub
                </button>
              </div>

              {isGitHubConnected ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => handleInstallGitHubApp(true)}
                >
                  Reconnect GitHub App (Auth)
                </button>
              ) : null}

              <label className={styles.inlineLabel}>
                Repository selection (optional prefill)
                <select
                  value={selectedRepoId}
                  onChange={(event) => handleRepoSelect(event.target.value)}
                >
                  <option value="">Select repository</option>
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
                <button type="submit" disabled={!isSignedIn || !isGitHubConnected}>
                  Create Project
                </button>
              </form>

              <label className={styles.inlineLabel}>
                Active project
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                >
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.inlineActions}>
                <button type="button" onClick={handleStartSession} disabled={!selectedProjectId}>
                  Initialize Codex Session
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleSignOut}
                  disabled={!isSignedIn}
                >
                  Sign Out
                </button>
              </div>
            </section>
          ) : null}

          {activeStage === 2 ? (
            <section className={styles.section}>
              <h2>Stage 2: Source Relevance Gate</h2>
              <p className={styles.hint}>
                Scan sources, select trusted context, and explicitly confirm relevance.
              </p>

              <div className={styles.inlineActions}>
                <button type="button" onClick={handleScanSources} disabled={!selectedProjectId}>
                  Scan Sources
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleConfirmManifest}
                  disabled={sources.length === 0}
                >
                  Confirm Source Manifest
                </button>
              </div>

              {sources.length === 0 ? (
                <p className={styles.hint}>No sources yet. Run scan to discover candidates.</p>
              ) : (
                <div className={styles.sourceList}>
                  {sources.map((source) => (
                    <label key={source.id} className={styles.sourceRow}>
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(source.id)}
                        onChange={() => handleToggleSource(source.id)}
                      />
                      <span className={styles.sourceMeta}>
                        <strong>{source.title}</strong>
                        <span>{source.path}</span>
                        <span>
                          {source.type} | score {source.relevanceScore} | status {source.status}
                        </span>
                        {source.warnings.length > 0 ? (
                          <span className={styles.sourceWarning}>
                            {source.warnings.join(" ")}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <label className={styles.inlineLabel}>
                Confirmation note
                <input
                  value={confirmationNote}
                  onChange={(event) => setConfirmationNote(event.target.value)}
                  placeholder="Selected sources align with current product direction."
                />
              </label>

              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={includeStaleConfirmed}
                  onChange={(event) => setIncludeStaleConfirmed(event.target.checked)}
                />
                I understand stale sources may degrade scenario quality.
              </label>

              {latestManifest ? (
                <p className={styles.hint}>
                  Latest manifest: <strong>{latestManifest.id}</strong> (hash{" "}
                  {latestManifest.manifestHash}).
                </p>
              ) : null}
            </section>
          ) : null}

          {activeStage === 3 ? (
            <section className={styles.section}>
              <h2>Stage 3: Generate Scenario Packs</h2>
              <p className={styles.hint}>
                Build grouped scenarios by feature and user outcome from confirmed sources.
              </p>

              <button
                type="button"
                onClick={handleGenerateScenarios}
                disabled={!selectedProjectId || !latestManifest}
              >
                Generate Scenarios
              </button>

              <label className={styles.inlineLabel}>
                Active scenario pack
                <select
                  value={selectedPack?.id ?? ""}
                  onChange={(event) => setSelectedScenarioPackId(event.target.value)}
                >
                  <option value="">Select pack</option>
                  {scenarioPacks.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.id} ({pack.scenarios.length} scenarios)
                    </option>
                  ))}
                </select>
              </label>

              {selectedPack ? (
                <>
                  <p className={styles.hint}>
                    Generated with <strong>{selectedPack.model}</strong> and manifest{" "}
                    <strong>{selectedPack.manifestId}</strong>.
                  </p>

                  <h3>Feature Groups</h3>
                  <ul className={styles.flatList}>
                    {Object.entries(selectedPack.groupedByFeature).map(([feature, ids]) => (
                      <li key={feature}>
                        <strong>{feature}</strong>: {ids.length} scenarios
                      </li>
                    ))}
                  </ul>

                  <h3>Outcome Groups</h3>
                  <ul className={styles.flatList}>
                    {Object.entries(selectedPack.groupedByOutcome).map(([outcome, ids]) => (
                      <li key={outcome}>
                        <strong>{outcome}</strong>: {ids.length} scenarios
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className={styles.hint}>No scenario pack generated yet.</p>
              )}
            </section>
          ) : null}

          {activeStage === 4 ? (
            <section className={styles.section}>
              <h2>Stage 4: Run Engine + Evidence</h2>
              <p className={styles.hint}>
                Execute scenario sets and inspect status transitions with evidence artifacts.
              </p>

              <button type="button" onClick={handleRunScenarios} disabled={!selectedPack}>
                Run Selected Pack
              </button>

              {latestRun ? (
                <>
                  <p className={styles.hint}>
                    Latest run <strong>{latestRun.id}</strong>: {latestRun.summary.passed} passed,{" "}
                    {latestRun.summary.failed} failed, {latestRun.summary.blocked} blocked.
                  </p>

                  <h3>Live Event Feed</h3>
                  <ul className={styles.flatList}>
                    {liveEvents.map((event) => (
                      <li key={event.id}>
                        {event.timestamp} | {event.scenarioId} | {event.status}
                      </li>
                    ))}
                  </ul>

                  <h3>Scenario Evidence</h3>
                  <ul className={styles.flatList}>
                    {latestRun.items.map((item) => (
                      <li key={item.scenarioId}>
                        <strong>{item.scenarioId}</strong> [{item.status}] - {item.observed}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className={styles.hint}>No runs yet.</p>
              )}
            </section>
          ) : null}

          {activeStage === 5 ? (
            <section className={styles.section}>
              <h2>Stage 5: Auto-Fix + PR Creation</h2>
              <p className={styles.hint}>
                Convert failed scenarios into fix attempts and PR records with rerun evidence.
              </p>

              <div className={styles.inlineActions}>
                <button type="button" onClick={handleAutoFix} disabled={!latestRun}>
                  Auto-Fix Failed Scenarios
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleCreatePullRequest}
                  disabled={!latestFixAttempt}
                >
                  Create PR Record
                </button>
              </div>

              {latestFixAttempt ? (
                <>
                  <h3>Latest Fix Attempt</h3>
                  <p className={styles.hint}>
                    {latestFixAttempt.id} | model {latestFixAttempt.model}
                  </p>
                  <p className={styles.hint}>{latestFixAttempt.probableRootCause}</p>
                  <p className={styles.hint}>{latestFixAttempt.patchSummary}</p>
                </>
              ) : (
                <p className={styles.hint}>No fix attempt yet.</p>
              )}

              <h3>PR Records</h3>
              <ul className={styles.flatList}>
                {pullRequests.map((record) => (
                  <li key={record.id}>
                    <strong>{record.title}</strong> ({record.status}) - {record.url}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activeStage === 6 ? (
            <section className={styles.section}>
              <h2>Stage 6: Review Board + Report</h2>
              <p className={styles.hint}>
                Consolidate scenario outcomes, risks, recommendations, and export report.
              </p>

              <div className={styles.inlineActions}>
                <button type="button" onClick={handleRefreshReviewBoard}>
                  Refresh Review Board
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleExportReport}
                >
                  Export Report
                </button>
              </div>

              {reviewBoard ? (
                <>
                  <p className={styles.hint}>
                    Coverage pass rate: <strong>{reviewBoard.coverage.passRate}%</strong>
                  </p>
                  <p className={styles.hint}>
                    Risks: {reviewBoard.risks.length} | PRs: {reviewBoard.pullRequests.length}
                  </p>
                  <h3>Recommendations</h3>
                  <ul className={styles.flatList}>
                    {reviewBoard.recommendations.map((recommendation) => (
                      <li key={recommendation.id}>
                        [{recommendation.priority}] {recommendation.title}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className={styles.hint}>No review board generated yet.</p>
              )}

              {reviewReport ? (
                <>
                  <h3>Exported Report</h3>
                  <pre className={styles.report}>{reviewReport}</pre>
                </>
              ) : null}
            </section>
          ) : null}
        </article>

        <aside className={`${styles.panel} ${styles.summaryPanel}`}>
          <h2>Snapshot</h2>
          <div className={styles.metaList}>
            <p>
              <strong>Owner:</strong> {authPrincipal?.displayName ?? "None"}
            </p>
            <p>
              <strong>Project:</strong> {activeProject?.name ?? "None"}
            </p>
            <p>
              <strong>GitHub:</strong>{" "}
              {githubConnection ? `Connected (#${githubConnection.installationId})` : "None"}
            </p>
            <p>
              <strong>Sessions:</strong> {sessions.length}
            </p>
            <p>
              <strong>Sources:</strong> {sources.length}
            </p>
            <p>
              <strong>Manifests:</strong> {manifests.length}
            </p>
            <p>
              <strong>Scenario packs:</strong> {scenarioPacks.length}
            </p>
            <p>
              <strong>Runs:</strong> {scenarioRuns.length}
            </p>
            <p>
              <strong>Fix attempts:</strong> {fixAttempts.length}
            </p>
            <p>
              <strong>PR records:</strong> {pullRequests.length}
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
};
