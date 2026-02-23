export type ProjectStatus = "draft" | "active";

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  repoUrl: string | null;
  defaultBranch: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export type AuthProvider = "chatgpt";

export interface AuthPrincipal {
  id: string;
  provider: AuthProvider;
  displayName: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  principalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

export interface GitHubConnection {
  id: string;
  principalId: string;
  provider: "github_app";
  status: "connected" | "disconnected";
  accountLogin: string | null;
  installationId: number;
  accessToken: string;
  accessTokenExpiresAt: string | null;
  repositories: GitHubRepository[];
  createdAt: string;
  updatedAt: string;
}

export interface JsonRpcRequest {
  method: string;
  id: number;
  params: Record<string, unknown>;
}

export interface CodexSession {
  id: string;
  ownerId: string;
  projectId: string;
  status: "initialized" | "thread-ready";
  transport: "skeleton";
  createdAt: string;
  updatedAt: string;
  initializeRequest: JsonRpcRequest;
  threadStartRequest: JsonRpcRequest;
  preferredModels: {
    research: string;
    implementation: string;
  };
}
