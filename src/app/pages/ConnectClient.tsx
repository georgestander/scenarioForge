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
  const { setStatusMessage, statusMessage } = useSession();
  const [connection, setConnection] = useState<GitHubConnectionView | null>(initialConnection);
  const [repos, setRepos] = useState<GitHubRepository[]>(initialRepos);
  const [manualInstallationId, setManualInstallationId] = useState("");
  const isConnected = Boolean(connection);

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
        "GitHub connected, but no repositories are granted. Open installation settings and grant repo access, then click Sync Repositories.",
      );
      return true;
    }

    setStatusMessage(
      `GitHub synced. ${payload.repositories.length} repository(ies) available.`,
    );
    return true;
  };

  const handleManualConnect = async (overrideId?: string): Promise<boolean> => {
    const rawId = overrideId?.trim() ?? manualInstallationId.trim();
    const installationId = Number(rawId);

    if (!Number.isInteger(installationId) || installationId <= 0) {
      setStatusMessage("Installation ID is required.");
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
      setStatusMessage("Connected, but no repositories granted. Update access in GitHub settings, then Sync.");
      return true;
    }

    setStatusMessage(`Connected installation ${installationId}. ${payload.repositories.length} repo(s) available.`);
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
        setStatusMessage("If install finished, click Sync Repositories.");
      }
    };
    window.setTimeout(run, 2500);
  };

  const handleInstallApp = async (forceReconnect = false) => {
    const suffix = forceReconnect ? "?force=1" : "";
    const response = await fetch(`/api/github/connect/start${suffix}`);
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

    setStatusMessage("Opened GitHub install in a new tab. This tab will auto-sync when done.");
    pollForConnection();
  };

  const handleDisconnect = async () => {
    const response = await fetch("/api/github/disconnect", { method: "POST" });
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to disconnect GitHub."));
      return;
    }
    await refreshConnection();
    setStatusMessage("GitHub App disconnected.");
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

  return (
    <section style={{ display: "grid", gap: "0.55rem" }}>
      <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        Connect GitHub
      </h2>
      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Project: <strong>{project.name}</strong> | {project.repoUrl ?? "No repo URL"} | {project.defaultBranch}
      </p>

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

      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button type="button" onClick={() => handleInstallApp(false)}>
          {isConnected ? "Sync Repositories" : "Connect GitHub"}
        </button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={!isConnected}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          Disconnect GitHub
        </button>
      </div>

      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Fallback: connect by installation ID if app is already installed.
      </p>
      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Installation ID
        <input
          value={manualInstallationId}
          onChange={(e) => setManualInstallationId(e.target.value)}
          placeholder="e.g. 12345678"
        />
      </label>
      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button
          type="button"
          onClick={() => void handleManualConnect()}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          Connect by ID
        </button>
        <button
          type="button"
          onClick={() => handleInstallApp(true)}
          disabled={!isConnected}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          Reconnect GitHub App
        </button>
      </div>

      {isConnected && connection ? (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          Connected as <strong>{connection.accountLogin ?? "unknown"}</strong> (installation #{connection.installationId}).
          {repos.length > 0 ? ` ${repos.length} repo(s) available.` : " No repos granted."}
        </p>
      ) : null}

      {repos.length > 0 ? (
        <div style={{ display: "grid", gap: "0.42rem" }}>
          {repos.map((repo) => (
            <div
              key={repo.id}
              style={{
                border: "1px solid var(--forge-line)",
                borderRadius: "9px",
                padding: "0.48rem 0.55rem",
                background: "#0f1628",
                fontSize: "0.83rem",
                color: "var(--forge-muted)",
              }}
            >
              <strong style={{ color: "var(--forge-ink)" }}>{repo.fullName}</strong>
              {" | "}{repo.defaultBranch}{repo.private ? " | private" : ""}
            </div>
          ))}
        </div>
      ) : null}

      <a
        href={`/projects/${projectId}/sources`}
        style={{
          display: "inline-block",
          padding: "0.52rem 0.62rem",
          borderRadius: "7px",
          border: "1px solid #7f482b",
          background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
          color: "var(--forge-ink)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.89rem",
          textAlign: "center",
          opacity: isConnected ? 1 : 0.55,
          pointerEvents: isConnected ? "auto" : "none",
        }}
      >
        Next: Select Sources →
      </a>
    </section>
  );
};
