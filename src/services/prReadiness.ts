import { env } from "cloudflare:workers";
import type { GitHubConnection, Project, ProjectPrReadiness } from "@/domain/models";

interface GitHubRepoResponse {
  full_name?: string;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
}

const parseRepoFullName = (repoUrl: string | null): string | null => {
  if (!repoUrl) {
    return null;
  }

  try {
    const url = new URL(repoUrl);
    const fullName = url.pathname.replace(/^\/+/g, "").replace(/\.git$/i, "");
    return fullName || null;
  } catch {
    return null;
  }
};

const githubHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ScenarioForge",
});

const readGitHubError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? `status ${response.status}`;
  } catch {
    return `status ${response.status}`;
  }
};

const uniqueStrings = (items: string[]): string[] =>
  [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];

export const evaluateProjectPrReadiness = async ({
  ownerId,
  project,
  githubConnection,
}: {
  ownerId: string;
  project: Project;
  githubConnection: GitHubConnection | null;
}): Promise<Omit<ProjectPrReadiness, "id" | "createdAt" | "updatedAt">> => {
  const checkedAt = new Date().toISOString();
  const repositoryFullName = parseRepoFullName(project.repoUrl);
  const branch = project.defaultBranch.trim() || "main";
  const reasons: string[] = [];
  const recommendedActions: string[] = [];

  const capabilities: ProjectPrReadiness["capabilities"] = {
    hasGitHubConnection: Boolean(githubConnection && githubConnection.status === "connected"),
    repositoryConfigured: Boolean(repositoryFullName),
    repositoryAccessible: false,
    branchExists: false,
    canPush: false,
    canCreateBranch: false,
    canOpenPr: false,
    codexBridgeConfigured: Boolean(env.CODEX_AUTH_BRIDGE_URL?.trim()),
  };

  if (!capabilities.codexBridgeConfigured) {
    reasons.push("CODEX_AUTH_BRIDGE_URL is not configured.");
    recommendedActions.push("Set CODEX_AUTH_BRIDGE_URL so execute/generate can call Codex app-server.");
  }

  if (!capabilities.repositoryConfigured) {
    reasons.push("Project repository is not configured.");
    recommendedActions.push("Select a repository on the Connect step.");
  }

  if (!capabilities.hasGitHubConnection || !githubConnection) {
    reasons.push("GitHub app is not connected for this account.");
    recommendedActions.push("Connect GitHub app and sync repositories.");
  }

  if (
    githubConnection &&
    repositoryFullName &&
    !githubConnection.repositories.some(
      (repository) =>
        repository.fullName.toLowerCase() === repositoryFullName.toLowerCase(),
    )
  ) {
    reasons.push(
      `Connected installation does not include repository '${repositoryFullName}'.`,
    );
    recommendedActions.push("Grant repository access in GitHub app installation and re-sync.");
  }

  const token = githubConnection?.accessToken.trim() ?? "";
  if (githubConnection && !token) {
    reasons.push("GitHub installation token is unavailable.");
    recommendedActions.push("Reconnect GitHub app installation to refresh token.");
  }

  if (repositoryFullName && token) {
    const encodedRepo = repositoryFullName
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    try {
      const repoResponse = await fetch(`https://api.github.com/repos/${encodedRepo}`, {
        method: "GET",
        headers: githubHeaders(token),
      });

      if (!repoResponse.ok) {
        reasons.push(
          `Repository access check failed for '${repositoryFullName}' (${await readGitHubError(repoResponse)}).`,
        );
      } else {
        const repoPayload = (await repoResponse.json()) as GitHubRepoResponse;
        const permissions = repoPayload.permissions ?? {};
        const canPush = Boolean(permissions.push || permissions.admin || permissions.maintain);
        const canPull = Boolean(
          permissions.pull ||
            permissions.push ||
            permissions.admin ||
            permissions.maintain ||
            permissions.triage,
        );

        capabilities.repositoryAccessible = true;
        capabilities.canPush = canPush;
        capabilities.canCreateBranch = canPush;
        capabilities.canOpenPr = canPush && canPull;

        if (!canPush) {
          reasons.push(
            "Connected token lacks push/admin permission required for branch and PR automation.",
          );
          recommendedActions.push("Grant write permissions to the GitHub app installation.");
        }

        if (!capabilities.canOpenPr) {
          reasons.push("Current permissions cannot open pull requests automatically.");
          recommendedActions.push("Ensure installation has pull-request and contents write permissions.");
        }
      }

      const branchResponse = await fetch(
        `https://api.github.com/repos/${encodedRepo}/branches/${encodeURIComponent(branch)}`,
        {
          method: "GET",
          headers: githubHeaders(token),
        },
      );

      if (branchResponse.ok) {
        capabilities.branchExists = true;
      } else {
        reasons.push(
          `Configured branch '${branch}' is not accessible (${await readGitHubError(branchResponse)}).`,
        );
        recommendedActions.push("Set a valid default branch on Connect.");
      }
    } catch (error) {
      reasons.push(
        error instanceof Error
          ? `GitHub readiness check failed: ${error.message}`
          : "GitHub readiness check failed.",
      );
      recommendedActions.push("Retry readiness check after verifying network and installation access.");
    }
  }

  const requiredForFullMode = [
    capabilities.codexBridgeConfigured,
    capabilities.hasGitHubConnection,
    capabilities.repositoryConfigured,
    capabilities.repositoryAccessible,
    capabilities.branchExists,
    capabilities.canPush,
    capabilities.canCreateBranch,
    capabilities.canOpenPr,
  ];

  return {
    ownerId,
    projectId: project.id,
    repositoryFullName,
    branch,
    status: requiredForFullMode.every(Boolean) ? "ready" : "needs_attention",
    capabilities,
    reasons: uniqueStrings(reasons),
    recommendedActions: uniqueStrings(recommendedActions),
    checkedAt,
  };
};
