"use client";

import { useEffect, useState } from "react";
import type { GitHubRepository, Project } from "@/domain/models";
import { readError, openInNewTab } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type {
  GitHubConnectionView,
  GitHubConnectionPayload,
  GitHubInstallPayload,
  GitHubConnectPayload,
  GitHubSyncPayload,
  CollectionPayload,
} from "@/app/shared/types";

export const ConnectClient = ({
  projectId,
  project,
  initialConnection,
  initialRepos,
}: {
  projectId: string;
  project: Project;
  initialConnection: GitHubConnectionView | null;
  initialRepos: GitHubRepository[];
}) => {
  const { authPrincipal, setStatusMessage, statusMessage } = useSession();
  const [connection, setConnection] = useState<GitHubConnectionView | null>(initialConnection);
  const [repos, setRepos] = useState<GitHubRepository[]>(initialRepos);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState(project.defaultBranch || "main");
  const [projectName, setProjectName] = useState(project.name || "");
  const [isSaving, setIsSaving] = useState(false);
  const isConnected = Boolean(connection);

  // Auto-select first repo if repos available
  useEffect(() => {
    if (repos.length > 0 && !selectedRepo) {
      setSelectedRepo(repos[0].fullName);
      setSelectedBranch(repos[0].defaultBranch);
    }
  }, [repos]);

  const refreshConnection = async () => {
    const [connRes, reposRes] = await Promise.all([
      fetch("/api/github/connection"),
      fetch("/api/github/repos"),
    ]);

    if (connRes.ok) {
      const payload = (await connRes.json()) as GitHubConnectionPayload;
      setConnection(payload.connection ?? null);
    }

    if (reposRes.ok) {
      const payload = (await reposRes.json()) as CollectionPayload<GitHubRepository>;
      setRepos(payload.data ?? []);
    }
  };

  const handleSyncConnection = async (): Promise<boolean> => {
    const response = await fetch("/api/github/connect/sync", { method: "POST" });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to sync GitHub repositories."));
      return false;
    }

    const payload = (await response.json()) as GitHubSyncPayload;
    await refreshConnection();

    if (payload.repositories.length === 0) {
      setStatusMessage(
        "GitHub connected, but no repositories are granted. Open installation settings and grant repo access, then click Sync.",
      );
      return true;
    }

    setStatusMessage(
      `GitHub synced. ${payload.repositories.length} repository(ies) available.`,
    );
    return true;
  };

  const handleManualConnect = async (overrideId?: string): Promise<boolean> => {
    const rawId = overrideId?.trim() ?? "";
    const installationId = Number(rawId);

    if (!Number.isInteger(installationId) || installationId <= 0) {
      return false;
    }

    const response = await fetch("/api/github/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to connect using installation ID."));
      return false;
    }

    const payload = (await response.json()) as GitHubConnectPayload;
    await refreshConnection();

    if (payload.repositories.length === 0) {
      setStatusMessage("Connected, but no repositories granted. Update access in GitHub settings, then reconnect.");
      return true;
    }

    setStatusMessage(`Connected. ${payload.repositories.length} repo(s) available.`);
    return true;
  };

  const pollForConnection = () => {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      const res = await fetch("/api/github/connection");
      if (res.ok) {
        const payload = (await res.json()) as GitHubConnectionPayload;
        if (payload.connection) {
          await handleSyncConnection();
          return;
        }
      }
      if (attempts < 30) {
        window.setTimeout(run, 2000);
      } else {
        setStatusMessage("If install finished, reload the page.");
      }
    };
    window.setTimeout(run, 2500);
  };

  const handleConnectGitHub = async () => {
    const response = await fetch("/api/github/connect/start");
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to start GitHub connect."));
      return;
    }

    const payload = (await response.json()) as GitHubInstallPayload;

    if (payload.alreadyConnected) {
      const synced = await handleSyncConnection();
      if (synced) return;
      if (payload.manageUrl) {
        setStatusMessage("GitHub already connected. Opening installation settings.");
        openInNewTab(payload.manageUrl, "GitHub installation settings");
      }
      return;
    }

    if (!payload.installUrl) {
      setStatusMessage("Unable to find GitHub installation URL.");
      return;
    }

    const result = openInNewTab(payload.installUrl, "GitHub install");
    if (result === "blocked") {
      setStatusMessage("Pop-up blocked. Allow pop-ups for this site.");
      return;
    }

    setStatusMessage("Opened GitHub install in a new tab. This page will auto-sync when done.");
    pollForConnection();
  };

  const handleNext = async () => {
    if (!selectedRepo) {
      setStatusMessage("Select a repository.");
      return;
    }
    if (!projectName.trim()) {
      setStatusMessage("Enter a project name.");
      return;
    }

    setIsSaving(true);
    try {
      const repo = repos.find((r) => r.fullName === selectedRepo);
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          repoUrl: repo?.url ?? selectedRepo,
          defaultBranch: selectedBranch || "main",
        }),
      });

      if (!response.ok) {
        setStatusMessage(await readError(response, "Failed to save project."));
        return;
      }

      window.location.href = `/projects/${projectId}/sources`;
    } finally {
      setIsSaving(false);
    }
  };

  // Auto-connect from URL query param
  useEffect(() => {
    const url = new URL(window.location.href);
    const installId = url.searchParams.get("installation_id");
    if (installId) {
      url.searchParams.delete("installation_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      void handleManualConnect(installId);
    }
  }, []);

  // Update branch when repo changes
  const handleRepoChange = (fullName: string) => {
    setSelectedRepo(fullName);
    const repo = repos.find((r) => r.fullName === fullName);
    if (repo) {
      setSelectedBranch(repo.defaultBranch);
    }
  };

  const displayName = authPrincipal?.displayName ?? "there";

  return (
    <section style={{ maxWidth: "420px", margin: "0 auto", padding: "2rem 0", display: "grid", gap: "1.2rem", textAlign: "center" }}>

      <p style={{ margin: 0, fontSize: "1rem", color: "var(--forge-ink)", lineHeight: 1.6 }}>
        Hi <strong>{displayName}</strong>, welcome to Scenario Forge.
        {isConnected
          ? " Select your repo and branch below."
          : " Let's get you started right away by connecting your GitHub account."}
      </p>

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

      {!isConnected ? (
        <button type="button" onClick={() => void handleConnectGitHub()} style={{ justifySelf: "center", padding: "0.6rem 1.4rem", fontSize: "0.95rem" }}>
          Connect with GitHub
        </button>
      ) : null}

      {isConnected ? (
        <>
          <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)", textAlign: "left" }}>
            Select repo
            <select
              value={selectedRepo}
              onChange={(e) => handleRepoChange(e.target.value)}
            >
              <option value="">Select repo</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.fullName}>
                  {repo.fullName}{repo.private ? " (private)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)", textAlign: "left" }}>
            Select branch
            <input
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              placeholder="main"
            />
          </label>

          <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)", textAlign: "left" }}>
            Project Name
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My Project"
            />
          </label>
        </>
      ) : null}

      <div style={{ justifySelf: "end" }}>
        <button
          type="button"
          onClick={() => void handleNext()}
          disabled={!isConnected || !selectedRepo || !projectName.trim() || isSaving}
          style={{ padding: "0.55rem 1.4rem" }}
        >
          {isSaving ? "Saving..." : "next"}
        </button>
      </div>
    </section>
  );
};
