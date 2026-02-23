import type { CodexSession, JsonRpcRequest } from "@/domain/models";
import { createCodexSession, getProjectByIdForOwner } from "@/services/store";

interface StartCodexSessionInput {
  ownerId: string;
  projectId: string;
}

const buildInitializeRequest = (): JsonRpcRequest => ({
  method: "initialize",
  id: 1,
  params: {
    clientInfo: {
      name: "scenarioforge_web",
      title: "ScenarioForge Web",
      version: "0.1.0",
    },
  },
});

const buildThreadStartRequest = (): JsonRpcRequest => ({
  method: "thread/start",
  id: 2,
  params: {
    model: "gpt-5.3-xhigh",
    approvalPolicy: "unlessTrusted",
    sandbox: "workspaceWrite",
  },
});

export const startCodexSession = (
  input: StartCodexSessionInput,
): CodexSession => {
  const project = getProjectByIdForOwner(input.projectId, input.ownerId);

  if (!project) {
    throw new Error("Project not found.");
  }

  return createCodexSession({
    ownerId: input.ownerId,
    projectId: project.id,
    status: "initialized",
    transport: "skeleton",
    initializeRequest: buildInitializeRequest(),
    threadStartRequest: buildThreadStartRequest(),
    preferredModels: {
      research: "codex spark",
      implementation: "gpt-5.3-xhigh",
    },
  });
};
