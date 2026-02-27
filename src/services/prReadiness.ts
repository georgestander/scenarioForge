import { env } from "cloudflare:workers";
import type {
  GitHubConnection,
  Project,
  ProjectPrReadiness,
  ProjectPrReadinessActuator,
  ProjectPrReadinessProbeResult,
  ProjectPrReadinessProbeStep,
  ProjectPrReadinessReasonCode,
} from "@/domain/models";

interface GitHubRepoResponse {
  full_name?: string;
}

interface GitHubRepoInstallationResponse {
  permissions?: Record<string, string>;
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

const uniqueReasonCodes = (items: ProjectPrReadinessReasonCode[]) =>
  [...new Set(items)];

export const evaluateProjectPrReadiness = async ({
  ownerId,
  project,
  githubConnection,
}: {
  ownerId: string;
  project: Project;
  githubConnection: GitHubConnection | null;
}): Promise<Omit<ProjectPrReadiness, "id" | "createdAt" | "updatedAt">> => {
  const startedAtMs = Date.now();
  const checkedAt = new Date().toISOString();
  const repositoryFullName = parseRepoFullName(project.repoUrl);
  const branch = project.defaultBranch.trim() || "main";
  const reasonCodes: ProjectPrReadinessReasonCode[] = [];
  const reasons: string[] = [];
  const recommendedActions: string[] = [];
  const probeResults: ProjectPrReadinessProbeResult[] = [];

  const addProbe = (
    step: ProjectPrReadinessProbeStep,
    ok: boolean,
    message: string,
    reasonCode: ProjectPrReadinessReasonCode | null = null,
  ) => {
    probeResults.push({
      step,
      ok,
      reasonCode,
      message,
    });
  };

  const addIssue = ({
    code,
    message,
    action,
    step,
  }: {
    code: ProjectPrReadinessReasonCode;
    message: string;
    action?: string;
    step?: ProjectPrReadinessProbeStep;
  }) => {
    reasonCodes.push(code);
    reasons.push(message);
    if (action) {
      recommendedActions.push(action);
    }
    if (step) {
      addProbe(step, false, message, code);
    }
  };

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
    addIssue({
      code: "CODEX_BRIDGE_UNREACHABLE",
      message: "CODEX_AUTH_BRIDGE_URL is not configured.",
      action:
        "Set CODEX_AUTH_BRIDGE_URL so execute/generate can call Codex app-server.",
      step: "codex_bridge",
    });
  } else {
    addProbe("codex_bridge", true, "Codex bridge endpoint is configured.");
  }

  if (!capabilities.repositoryConfigured) {
    addIssue({
      code: "GITHUB_REPO_NOT_CONFIGURED",
      message: "Project repository is not configured.",
      action: "Select a repository on the Connect step.",
      step: "repository_config",
    });
  } else {
    addProbe("repository_config", true, "Project repository is configured.");
  }

  if (!capabilities.hasGitHubConnection || !githubConnection) {
    addIssue({
      code: "GITHUB_CONNECTION_MISSING",
      message: "GitHub app is not connected for this account.",
      action: "Connect GitHub app and sync repositories.",
      step: "github_connection",
    });
  } else {
    addProbe("github_connection", true, "GitHub app is connected.");
  }

  if (
    githubConnection &&
    repositoryFullName &&
    !githubConnection.repositories.some(
      (repository) =>
        repository.fullName.toLowerCase() === repositoryFullName.toLowerCase(),
    )
  ) {
    addIssue({
      code: "GITHUB_REPO_READ_DENIED",
      message: `Connected installation does not include repository '${repositoryFullName}'.`,
      action: "Grant repository access in GitHub app installation and re-sync.",
      step: "repository_access",
    });
  }

  const token = githubConnection?.accessToken.trim() ?? "";
  if (githubConnection && !token) {
    addIssue({
      code: "GITHUB_CONNECTION_MISSING",
      message: "GitHub installation token is unavailable.",
      action: "Reconnect GitHub app installation to refresh token.",
      step: "github_connection",
    });
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
        addIssue({
          code: "GITHUB_REPO_READ_DENIED",
          message: `Repository access check failed for '${repositoryFullName}' (${await readGitHubError(repoResponse)}).`,
          action: "Verify repository access and installation scope, then re-run readiness.",
          step: "repository_access",
        });
      } else {
        await repoResponse.json();
        capabilities.repositoryAccessible = true;
        addProbe("repository_access", true, `Repository '${repositoryFullName}' is accessible.`);
        // Optimistic default: if the repo is reachable via installation token, allow full mode
        // unless installation permissions explicitly prove otherwise.
        capabilities.canPush = true;
        capabilities.canCreateBranch = true;
        capabilities.canOpenPr = true;

        const installationResponse = await fetch(
          `https://api.github.com/repos/${encodedRepo}/installation`,
          {
            method: "GET",
            headers: githubHeaders(token),
          },
        );

        if (installationResponse.ok) {
          const installationPayload =
            (await installationResponse.json()) as GitHubRepoInstallationResponse;
          const permissions = installationPayload.permissions ?? {};
          const contentsPermission = String(permissions.contents ?? "")
            .trim()
            .toLowerCase();
          const pullRequestsPermission = String(permissions.pull_requests ?? "")
            .trim()
            .toLowerCase();
          const hasExplicitPermissionSignal =
            contentsPermission.length > 0 || pullRequestsPermission.length > 0;

          if (hasExplicitPermissionSignal) {
            const canWriteContents =
              contentsPermission === "write" || contentsPermission === "admin";
            const canWritePullRequests =
              pullRequestsPermission === "write" || pullRequestsPermission === "admin";

            capabilities.canPush = canWriteContents;
            capabilities.canCreateBranch = canWriteContents;
            capabilities.canOpenPr = canWriteContents && canWritePullRequests;

            if (!canWriteContents) {
              addIssue({
                code: "GITHUB_WRITE_PERMISSIONS_MISSING",
                message:
                  "Connected installation is missing contents write permission required for branch automation.",
                action:
                  "Grant Contents: Read and write in GitHub app installation permissions.",
                step: "github_permissions",
              });
            }

            if (!canWritePullRequests) {
              addIssue({
                code: "GITHUB_WRITE_PERMISSIONS_MISSING",
                message:
                  "Connected installation is missing pull-request write permission required for PR automation.",
                action:
                  "Grant Pull requests: Read and write in GitHub app installation permissions.",
                step: "github_permissions",
              });
            }

            if (canWriteContents && canWritePullRequests) {
              addProbe(
                "github_permissions",
                true,
                "GitHub installation permissions allow branch and PR automation.",
              );
            }
          } else {
            addProbe(
              "github_permissions",
              true,
              "GitHub installation permissions probe returned no explicit permission map; using optimistic defaults.",
            );
          }
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
        addProbe("branch_access", true, `Branch '${branch}' is accessible.`);
      } else {
        addIssue({
          code: "GITHUB_BRANCH_NOT_FOUND",
          message: `Configured branch '${branch}' is not accessible (${await readGitHubError(branchResponse)}).`,
          action: "Set a valid default branch on Connect.",
          step: "branch_access",
        });
      }
    } catch (error) {
      addIssue({
        code: "GITHUB_REPO_READ_DENIED",
        message:
          error instanceof Error
            ? `GitHub readiness check failed: ${error.message}`
            : "GitHub readiness check failed.",
        action:
          "Retry readiness check after verifying network and installation access.",
        step: "repository_access",
      });
    }
  }

  let fullPrActuator: ProjectPrReadinessActuator = "none";
  if (capabilities.canPush && capabilities.canCreateBranch && capabilities.canOpenPr) {
    fullPrActuator = "controller";
    addProbe(
      "actuator_path",
      true,
      "Full PR actuator path resolved: controller.",
    );
  } else {
    addIssue({
      code: "PR_ACTUATOR_UNAVAILABLE",
      message:
        "No full PR actuator path is currently available for this project configuration.",
      action:
        "Use fix-only mode now, or satisfy readiness requirements for controller-owned branch/push/PR automation.",
      step: "actuator_path",
    });
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
    fullPrActuator !== "none",
  ];

  return {
    ownerId,
    projectId: project.id,
    repositoryFullName,
    branch,
    fullPrActuator,
    status: requiredForFullMode.every(Boolean) ? "ready" : "needs_attention",
    capabilities,
    reasonCodes: uniqueReasonCodes(reasonCodes),
    reasons: uniqueStrings(reasons),
    recommendedActions: uniqueStrings(recommendedActions),
    probeResults,
    probeDurationMs: Date.now() - startedAtMs,
    checkedAt,
  };
};
