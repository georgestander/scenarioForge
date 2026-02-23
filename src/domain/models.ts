export type ProjectStatus = "draft" | "active";

export interface Project {
  id: string;
  name: string;
  repoUrl: string | null;
  defaultBranch: string;
  status: ProjectStatus;
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
