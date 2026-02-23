import type { CodexSession, JsonRpcRequest } from "@/domain/models";
import { createCodexSession, getProjectById } from "@/services/store";

interface StartCodexSessionInput {
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
    model: "gpt-5.1-codex",
    approvalPolicy: "unlessTrusted",
    sandbox: "workspaceWrite",
  },
});

export const startCodexSession = (
  input: StartCodexSessionInput,
): CodexSession => {
  const project = getProjectById(input.projectId);

  if (!project) {
    throw new Error("Project not found.");
  }

  return createCodexSession({
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
