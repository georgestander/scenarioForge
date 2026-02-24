#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";
import readline from "node:readline";
import { URL } from "node:url";

const BRIDGE_HOST = process.env.CODEX_AUTH_BRIDGE_HOST || "127.0.0.1";
const BRIDGE_PORT = Number(process.env.CODEX_AUTH_BRIDGE_PORT || "4319");
const CODEX_BIN = process.env.CODEX_AUTH_BRIDGE_BIN || "codex";
const CODEX_ARGS =
  process.env.CODEX_AUTH_BRIDGE_ARGS?.trim().split(/\s+/).filter(Boolean) ?? [
    "app-server",
  ];
const RPC_TIMEOUT_MS = Number(process.env.CODEX_AUTH_BRIDGE_RPC_TIMEOUT_MS || "15000");
const TURN_COMPLETION_TIMEOUT_MS = Number(
  process.env.CODEX_AUTH_BRIDGE_TURN_TIMEOUT_MS || "180000",
);
const AGENT_MESSAGE_GRACE_MS = Number(
  process.env.CODEX_AUTH_BRIDGE_AGENT_MESSAGE_GRACE_MS || "15000",
);
const SSE_KEEPALIVE_MS = Number(
  process.env.CODEX_AUTH_BRIDGE_SSE_KEEPALIVE_MS || "12000",
);

let requestId = 1;
let isInitialized = false;
let authMode = null;
let initializePromise = null;

const pendingRequests = new Map();
const loginCompletions = new Map();
const turnCompletionWatchers = new Map();
const completedTurns = new Map();
const turnAgentMessages = new Map();
const turnEventSubscribers = new Map();

const codexProc = spawn(CODEX_BIN, CODEX_ARGS, {
  stdio: ["pipe", "pipe", "inherit"],
});

const readlineInterface = readline.createInterface({
  input: codexProc.stdout,
  crlfDelay: Infinity,
});

const nowIso = () => new Date().toISOString();

const writeJson = (stream, payload) => {
  stream.write(`${JSON.stringify(payload)}\n`);
};

const sendRpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = requestId;
    requestId += 1;

    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`${method} timed out after ${RPC_TIMEOUT_MS}ms.`));
    }, RPC_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
    });

    writeJson(codexProc.stdin, {
      method,
      id,
      params,
    });
  });

const sendNotification = (method, params = {}) => {
  writeJson(codexProc.stdin, {
    method,
    params,
  });
};

const readString = (value) => (typeof value === "string" ? value.trim() : "");

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isAgentMessageType = (value) => {
  const normalized = readString(value).toLowerCase();
  return (
    normalized === "agentmessage" ||
    normalized === "agent_message" ||
    normalized === "assistantmessage" ||
    normalized === "assistant_message"
  );
};

const extractMessageContentText = (content) => {
  if (!Array.isArray(content)) {
    return "";
  }

  const chunks = content
    .map((item) => {
      if (typeof item?.text === "string") {
        return item.text;
      }

      if (typeof item?.value === "string") {
        return item.value;
      }

      if (typeof item?.content === "string") {
        return item.content;
      }

      return "";
    })
    .filter(Boolean);

  return chunks.join("").trim();
};

const captureTurnAgentMessage = (turnId, text) => {
  const normalizedTurnId = readString(turnId);
  const normalizedText = readString(text);

  if (!normalizedTurnId || !normalizedText) {
    return;
  }

  turnAgentMessages.set(normalizedTurnId, normalizedText);
};

const appendTurnAgentMessageDelta = (turnId, delta) => {
  const normalizedTurnId = readString(turnId);
  if (!normalizedTurnId || typeof delta !== "string" || !delta.length) {
    return;
  }

  const current = turnAgentMessages.get(normalizedTurnId) ?? "";
  turnAgentMessages.set(normalizedTurnId, `${current}${delta}`);
};

const waitForTurnAgentMessage = async (
  turnId,
  timeoutMs = AGENT_MESSAGE_GRACE_MS,
) => {
  const normalizedTurnId = readString(turnId);
  if (!normalizedTurnId) {
    return "";
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = readString(turnAgentMessages.get(normalizedTurnId));
    if (text) {
      return text;
    }

    await sleep(75);
  }

  return readString(turnAgentMessages.get(normalizedTurnId));
};

const subscribeTurnEvents = (turnId, handler) => {
  const normalizedTurnId = readString(turnId);
  if (!normalizedTurnId) {
    return () => {};
  }

  const current = turnEventSubscribers.get(normalizedTurnId) ?? new Set();
  current.add(handler);
  turnEventSubscribers.set(normalizedTurnId, current);

  return () => {
    const next = turnEventSubscribers.get(normalizedTurnId);
    if (!next) {
      return;
    }

    next.delete(handler);
    if (next.size === 0) {
      turnEventSubscribers.delete(normalizedTurnId);
    }
  };
};

const emitTurnEvent = (turnId, event) => {
  const normalizedTurnId = readString(turnId);
  if (!normalizedTurnId) {
    return;
  }

  const listeners = turnEventSubscribers.get(normalizedTurnId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Never allow event listeners to break bridge processing.
    }
  });
};

const extractTurnIdFromNotification = (message) =>
  readString(
    message?.params?.turnId ??
      message?.params?.turn?.id ??
      message?.params?.msg?.turn_id ??
      message?.params?.id,
  );

const recordCompletedTurn = (turn) => {
  if (!turn || typeof turn.id !== "string" || !turn.id) {
    return;
  }

  completedTurns.set(turn.id, turn);
  const watcher = turnCompletionWatchers.get(turn.id);

  if (!watcher) {
    return;
  }

  clearTimeout(watcher.timeout);
  turnCompletionWatchers.delete(turn.id);
  watcher.resolve(turn);
};

const waitForTurnCompletion = (turnId, timeoutMs = TURN_COMPLETION_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    if (!turnId || typeof turnId !== "string") {
      reject(new Error("turnId is required to wait for completion."));
      return;
    }

    const cached = completedTurns.get(turnId);
    if (cached) {
      resolve(cached);
      return;
    }

    const timeout = setTimeout(() => {
      turnCompletionWatchers.delete(turnId);
      reject(new Error(`turn ${turnId} did not complete within ${timeoutMs}ms.`));
    }, timeoutMs);

    turnCompletionWatchers.set(turnId, {
      resolve,
      reject,
      timeout,
    });
  });

const setLoginCompletion = (payload) => {
  const key = payload.loginId ?? "__NO_LOGIN_ID__";
  loginCompletions.set(key, {
    loginId: payload.loginId ?? null,
    success: Boolean(payload.success),
    error: typeof payload.error === "string" ? payload.error : null,
    receivedAt: nowIso(),
  });
};

const consumeRpcResponse = (message) => {
  const pending = pendingRequests.get(message.id);

  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(message.id);

  if (message.error) {
    pending.reject(new Error(message.error.message || "Unknown JSON-RPC error."));
    return;
  }

  pending.resolve(message.result ?? {});
};

const replyRpcResult = (id, result) => {
  writeJson(codexProc.stdin, {
    id,
    result,
  });
};

const replyRpcError = (id, code, message) => {
  writeJson(codexProc.stdin, {
    id,
    error: {
      code,
      message,
    },
  });
};

const consumeRpcRequest = (message) => {
  const method = readString(message?.method);
  const id = message?.id;

  if ((typeof id !== "number" && typeof id !== "string") || !method) {
    return;
  }

  if (method.endsWith("/requestApproval")) {
    replyRpcResult(id, "acceptForSession");
    return;
  }

  if (method === "tool/requestUserInput") {
    replyRpcError(
      id,
      -32000,
      "Interactive user input is not supported by codex-auth-bridge. Re-run with a non-interactive flow.",
    );
    return;
  }

  replyRpcError(
    id,
    -32601,
    `Unsupported server request method '${method}' in codex-auth-bridge.`,
  );
};

const consumeNotification = (message) => {
  const turnId = extractTurnIdFromNotification(message);
  if (turnId) {
    emitTurnEvent(turnId, {
      method: readString(message.method) || "unknown",
      params: message.params ?? {},
      timestamp: nowIso(),
    });
  }

  if (message.method === "account/updated") {
    authMode = message.params?.authMode ?? null;
    return;
  }

  if (message.method === "account/login/completed") {
    setLoginCompletion(message.params ?? {});
    return;
  }

  if (message.method === "turn/completed") {
    recordCompletedTurn(message.params?.turn ?? null);
    return;
  }

  if (message.method === "item/completed") {
    const item = message.params?.item;
    if (isAgentMessageType(item?.type)) {
      captureTurnAgentMessage(
        message.params?.turnId,
        item?.text ?? extractMessageContentText(item?.content),
      );
    }
    return;
  }

  if (message.method === "item/agentMessage/delta") {
    appendTurnAgentMessageDelta(message.params?.turnId, message.params?.delta);
    return;
  }

  if (message.method === "codex/event/agent_message_delta") {
    appendTurnAgentMessageDelta(
      message.params?.msg?.turn_id ?? message.params?.id,
      message.params?.msg?.delta,
    );
    return;
  }

  if (message.method === "codex/event/agent_message") {
    captureTurnAgentMessage(
      message.params?.msg?.turn_id ?? message.params?.id,
      message.params?.msg?.message,
    );
    return;
  }

  if (message.method === "codex/event/item_completed") {
    const item = message.params?.msg?.item;
    if (isAgentMessageType(item?.type)) {
      captureTurnAgentMessage(
        message.params?.msg?.turn_id ?? message.params?.id,
        extractMessageContentText(item?.content),
      );
    }
    return;
  }

  if (message.method === "codex/event/task_complete") {
    captureTurnAgentMessage(
      message.params?.msg?.turn_id ?? message.params?.id,
      message.params?.msg?.last_agent_message,
    );
  }
};

readlineInterface.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    console.error("[codex-auth-bridge] Failed to parse JSON-RPC line:", error);
    return;
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const hasMethod = typeof message?.method === "string";
  const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
  const hasError = Object.prototype.hasOwnProperty.call(message, "error");

  if (hasId && hasMethod && !hasResult && !hasError) {
    consumeRpcRequest(message);
    return;
  }

  if (hasId) {
    consumeRpcResponse(message);
    return;
  }

  consumeNotification(message);
});

codexProc.on("error", (error) => {
  console.error("[codex-auth-bridge] Failed to spawn codex app-server:", error.message);
  process.exit(1);
});

codexProc.on("exit", (code, signal) => {
  const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  console.error(`[codex-auth-bridge] codex app-server exited (${reason}).`);
  process.exit(code ?? 1);
});

const parseBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
};

const sendError = (response, statusCode, error) => {
  sendJson(response, statusCode, { error });
};

const setSseHeaders = (response) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
};

const sendSse = (response, event, payload) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const parseTurnErrorMessage = (message) => {
  const raw = readString(message);
  if (!raw) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw);
    return readString(parsed?.detail) || raw;
  } catch {
    return raw;
  }
};

const readBridgeAccount = async (refreshToken) => {
  try {
    return await sendRpc("account/read", { refreshToken });
  } catch {
    return null;
  }
};

const assertAuthenticated = async () => {
  // First try a refresh to keep long-lived sessions healthy.
  const refreshed = await readBridgeAccount(true);
  if (refreshed) {
    const requiresAuth = Boolean(refreshed?.requiresOpenaiAuth);
    const hasAccount = Boolean(refreshed?.account);
    if (!requiresAuth || hasAccount) {
      return;
    }
  }

  // Fallback to non-refresh read so transient refresh failures do not kill runs.
  const current = await readBridgeAccount(false);
  const requiresAuth = Boolean(current?.requiresOpenaiAuth ?? true);
  const hasAccount = Boolean(current?.account);

  if (requiresAuth && !hasAccount) {
    throw new Error("ChatGPT sign-in is required before Codex actions can run.");
  }
};

const resolveModelId = async (requestedModel) => {
  const requested = readString(requestedModel);
  if (!requested) {
    return {
      requested: "codex spark",
      selected: "codex spark",
      available: false,
    };
  }

  let models = [];
  try {
    const modelList = await sendRpc("model/list", {
      includeHidden: true,
      limit: 200,
    });
    models = Array.isArray(modelList?.data) ? modelList.data : [];
  } catch {
    return {
      requested,
      selected: requested,
      available: false,
    };
  }

  const byId = new Map();
  models.forEach((entry) => {
    const id = readString(entry?.id);
    if (id) {
      byId.set(id.toLowerCase(), id);
    }
  });

  const exact = byId.get(requested.toLowerCase());
  if (exact) {
    return {
      requested,
      selected: exact,
      available: true,
    };
  }

  const requestedLower = requested.toLowerCase();
  const aliasCandidates =
    requestedLower === "codex spark" || requestedLower === "spark"
      ? [
          "gpt-5.3-codex-spark",
          "gpt-5.2-codex-spark",
          "gpt-5.1-codex-spark",
          "gpt-5-codex-spark",
        ]
      : [];

  for (const alias of aliasCandidates) {
    const matched = byId.get(alias);
    if (matched) {
      return {
        requested,
        selected: matched,
        available: true,
      };
    }
  }

  const defaultModel =
    models.find((entry) => entry?.isDefault && readString(entry?.id)) ??
    models.find((entry) => readString(entry?.id));
  const fallbackId = readString(defaultModel?.id);

  if (fallbackId) {
    return {
      requested,
      selected: fallbackId,
      available: true,
    };
  }

  return {
    requested,
    selected: requested,
    available: false,
  };
};

const normalizeSkillEntries = (skillsResult, cwd) => {
  const data = Array.isArray(skillsResult?.data) ? skillsResult.data : [];
  const normalizedCwd = readString(cwd);
  const output = [];

  data.forEach((entry) => {
    const entryCwd = readString(entry?.cwd);
    if (normalizedCwd && entryCwd && entryCwd !== normalizedCwd) {
      return;
    }

    const skills = Array.isArray(entry?.skills) ? entry.skills : [];
    skills.forEach((skill) => {
      output.push({
        name: readString(skill?.name),
        path: readString(skill?.path) || null,
      });
    });
  });

  return output.filter((skill) => skill.name.length > 0);
};

const resolveSkill = async (skillName, cwd) => {
  const normalizedSkillName = readString(skillName);
  const normalizedCwd = readString(cwd) || process.cwd();

  if (!normalizedSkillName) {
    return {
      requested: null,
      available: false,
      selected: null,
    };
  }

  try {
    const skillsResult = await sendRpc("skills/list", {
      cwds: [normalizedCwd],
      forceReload: true,
    });
    const skills = normalizeSkillEntries(skillsResult, normalizedCwd);
    const selected =
      skills.find(
        (skill) => skill.name.toLowerCase() === normalizedSkillName.toLowerCase(),
      ) ?? null;

    return {
      requested: normalizedSkillName,
      available: Boolean(selected),
      selected,
    };
  } catch {
    return {
      requested: normalizedSkillName,
      available: false,
      selected: null,
    };
  }
};

const extractTurnId = (turnResult) => readString(turnResult?.turn?.id);

const extractThreadId = (threadResult) => readString(threadResult?.thread?.id);

const extractTurnFromThreadRead = (threadReadResult, turnId) => {
  const turns = Array.isArray(threadReadResult?.thread?.turns)
    ? threadReadResult.thread.turns
    : [];
  return (
    turns.find((turn) => readString(turn?.id) === turnId) ??
    turns[turns.length - 1] ??
    null
  );
};

const extractAgentMessageText = (items) => {
  if (!Array.isArray(items)) {
    return "";
  }

  let finalText = "";

  items.forEach((item) => {
    if (!isAgentMessageType(item?.type)) {
      return;
    }

    if (typeof item?.text === "string") {
      finalText = item.text;
      return;
    }

    const contentText = extractMessageContentText(item?.content);
    if (contentText) {
      finalText = contentText;
    }
  });

  return finalText.trim();
};

const normalizeTurnOutput = (value) => {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  return value;
};

const extractTurnOutputObject = (turn) => {
  if (!turn || typeof turn !== "object") {
    return null;
  }

  const candidates = [
    turn.output,
    turn.outputText,
    turn.result?.output,
    turn.result?.response,
    turn.result,
    turn.response,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTurnOutput(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
};

const extractResponseText = (turnId, readTurn, completedTurn) => {
  const cachedMessage = readString(turnAgentMessages.get(turnId));
  if (cachedMessage) {
    return cachedMessage;
  }

  const itemMessage = extractAgentMessageText(readTurn?.items ?? completedTurn?.items ?? []);
  if (itemMessage) {
    return itemMessage;
  }

  const readOutput = extractTurnOutputObject(readTurn);
  if (typeof readOutput === "string" && readOutput.trim()) {
    return readOutput.trim();
  }

  if (readOutput && typeof readOutput === "object") {
    return JSON.stringify(readOutput);
  }

  const completedOutput = extractTurnOutputObject(completedTurn);
  if (typeof completedOutput === "string" && completedOutput.trim()) {
    return completedOutput.trim();
  }

  if (completedOutput && typeof completedOutput === "object") {
    return JSON.stringify(completedOutput);
  }

  return "";
};

const runActionTurn = async (actionName, body, onEvent = () => {}) => {
  const action = readString(actionName).toLowerCase();
  const prompt = readString(body?.prompt);

  if (!prompt) {
    throw new Error("prompt is required.");
  }

  if (action !== "generate" && action !== "execute") {
    throw new Error(`Unsupported action '${actionName}'.`);
  }

  await assertAuthenticated();

  const defaultModel = action === "execute" ? "gpt-5.3-xhigh" : "codex spark";
  const requestedModel = readString(body?.model) || defaultModel;
  const resolvedModel = await resolveModelId(requestedModel);
  const model = resolvedModel.selected;
  const cwd = readString(body?.cwd) || process.cwd();
  const requestedSkillName = readString(body?.skillName);
  const outputSchema =
    body?.outputSchema && typeof body.outputSchema === "object"
      ? body.outputSchema
      : null;
  const approvalPolicy = readString(body?.approvalPolicy) || "never";
  const threadSandbox =
    readString(body?.sandbox) || (action === "generate" ? "read-only" : "workspace-write");
  const sandboxPolicy =
    body?.sandboxPolicy && typeof body.sandboxPolicy === "object"
      ? body.sandboxPolicy
      : action === "generate"
        ? {
            type: "readOnly",
          }
        : {
            type: "workspaceWrite",
            networkAccess: true,
          };
  const turnTimeoutMs =
    Number.isFinite(Number(body?.turnTimeoutMs)) && Number(body.turnTimeoutMs) > 0
      ? Number(body.turnTimeoutMs)
      : TURN_COMPLETION_TIMEOUT_MS;

  const skillResolution = requestedSkillName
    ? await resolveSkill(requestedSkillName, cwd)
    : {
        requested: null,
        available: false,
        selected: null,
      };

  const textPrefix = skillResolution.available
    ? `$${requestedSkillName} `
    : `${action} request: `;

  const input = [
    {
      type: "text",
      text: `${textPrefix}${prompt}`,
    },
  ];

  if (skillResolution.available && skillResolution.selected?.path) {
    input.push({
      type: "skill",
      name: requestedSkillName,
      path: skillResolution.selected.path,
    });
  }

  onEvent({
    phase: "thread.starting",
    status: "running",
    message: `Starting ${action} thread...`,
    timestamp: nowIso(),
  });

  const threadResult = await sendRpc("thread/start", {
    model,
    cwd,
    approvalPolicy,
    sandbox: threadSandbox,
  });
  const threadId = extractThreadId(threadResult);

  if (!threadId) {
    throw new Error(`Failed to create a Codex thread for action '${action}'.`);
  }

  onEvent({
    phase: "thread.started",
    status: "running",
    message: `Thread ${threadId} started.`,
    timestamp: nowIso(),
    threadId,
  });

  const turnStartParams = {
    threadId,
    input,
    cwd,
    model,
    approvalPolicy,
    sandboxPolicy,
    outputSchema,
  };
  const turnResult = await sendRpc("turn/start", turnStartParams);
  const turnId = extractTurnId(turnResult);

  if (!turnId) {
    throw new Error(`Codex did not return a turn id for action '${action}'.`);
  }

  onEvent({
    phase: "turn.started",
    status: "running",
    message: `Turn ${turnId} started.`,
    timestamp: nowIso(),
    threadId,
    turnId,
  });

  const unsubscribe = subscribeTurnEvents(turnId, (event) => {
    onEvent({
      phase: "turn.event",
      status: "running",
      message: event.method,
      timestamp: event.timestamp ?? nowIso(),
      threadId,
      turnId,
      event,
    });
  });

  try {
    let completedTurn = null;
    let timedOutWaitingForCompletion = false;
    try {
      completedTurn = await waitForTurnCompletion(turnId, turnTimeoutMs);
    } catch {
      timedOutWaitingForCompletion = true;
      completedTurn = null;
    }

    let readTurn = null;
    try {
      const threadRead = await sendRpc("thread/read", {
        threadId,
        includeTurns: true,
      });
      readTurn = extractTurnFromThreadRead(threadRead, turnId);
    } catch {
      // Keep notification-derived turn if thread/read is unavailable.
    }

    const completedStatus = readString(completedTurn?.status);
    const readStatus = readString(readTurn?.status);
    const normalizedCompletedStatus = completedStatus.toLowerCase();
    const normalizedReadStatus = readStatus.toLowerCase();
    const normalizedStatus =
      normalizedCompletedStatus === "failed" || normalizedReadStatus === "failed"
        ? "failed"
        : (normalizedCompletedStatus || normalizedReadStatus || "unknown");
    const turnErrorMessage =
      parseTurnErrorMessage(completedTurn?.error?.message) ||
      parseTurnErrorMessage(readTurn?.error?.message);

    let responseText = extractResponseText(turnId, readTurn, completedTurn);

    if (!responseText) {
      responseText = await waitForTurnAgentMessage(turnId);
    }

    if (timedOutWaitingForCompletion) {
      const readTurnIsTerminal =
        normalizedReadStatus === "completed" ||
        normalizedReadStatus === "succeeded" ||
        normalizedReadStatus === "done";
      const completedTurnIsTerminal =
        normalizedCompletedStatus === "completed" ||
        normalizedCompletedStatus === "succeeded" ||
        normalizedCompletedStatus === "done";

      if (!readTurnIsTerminal && !completedTurnIsTerminal) {
        throw new Error(
          `turn ${turnId} did not complete within ${turnTimeoutMs}ms.`,
        );
      }
    }

    if (normalizedStatus === "failed") {
      throw new Error(
        turnErrorMessage ||
          `Codex ${action} turn failed without a detailed error message.`,
      );
    }

    const successfulTerminalStatus =
      normalizedStatus === "completed" ||
      normalizedStatus === "succeeded" ||
      normalizedStatus === "done";

    if (!successfulTerminalStatus) {
      throw new Error(
        `Codex ${action} turn did not reach terminal completion (status: ${normalizedStatus || "unknown"}).`,
      );
    }

    onEvent({
      phase: "turn.completed",
      status: "completed",
      message: `Turn ${turnId} completed with status ${normalizedStatus}.`,
      timestamp: nowIso(),
      threadId,
      turnId,
      turnStatus: normalizedStatus,
    });

    return {
      action,
      model,
      cwd,
      threadId,
      turnId,
      turnStatus: normalizedStatus,
      skillRequested: skillResolution.requested ?? (requestedSkillName || "none"),
      skillAvailable: skillResolution.available,
      skillUsed: skillResolution.available ? requestedSkillName : null,
      skillPath: skillResolution.selected?.path ?? null,
      responseText,
      output:
        extractTurnOutputObject(readTurn) ?? extractTurnOutputObject(completedTurn) ?? null,
      completedAt: nowIso(),
    };
  } finally {
    unsubscribe();
    turnAgentMessages.delete(turnId);
    completedTurns.delete(turnId);
  }
};

const runActionTurnStreaming = async (action, request, response) => {
  const body = await parseBody(request);
  setSseHeaders(response);

  const keepalive = setInterval(() => {
    response.write(`: keepalive ${nowIso()}\n\n`);
  }, SSE_KEEPALIVE_MS);

  try {
    sendSse(response, "started", {
      action,
      timestamp: nowIso(),
    });

    const result = await runActionTurn(action, body, (event) => {
      sendSse(response, "event", event);
    });

    sendSse(response, "completed", {
      action,
      result,
      timestamp: nowIso(),
    });
    response.end();
  } catch (error) {
    sendSse(response, "error", {
      action,
      error: error instanceof Error ? error.message : "Unknown bridge error.",
      timestamp: nowIso(),
    });
    response.end();
  } finally {
    clearInterval(keepalive);
  }
};

const ensureInitialized = async () => {
  if (isInitialized) {
    return;
  }

  if (initializePromise) {
    await initializePromise;
    return;
  }

  initializePromise = (async () => {
    try {
      await sendRpc("initialize", {
        clientInfo: {
          name: "scenarioforge",
          title: "ScenarioForge Auth Bridge",
          version: "0.2.0",
        },
      });
      sendNotification("initialized", {});
      isInitialized = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("Already initialized")) {
        isInitialized = true;
        return;
      }

      throw error;
    } finally {
      initializePromise = null;
    }
  })();

  await initializePromise;
};

const parseActionPath = (path) => {
  const match = path.match(/^\/actions\/(generate|execute)(\/stream)?$/i);
  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase(),
    stream: Boolean(match[2]),
  };
};

const handleRequest = async (request, response) => {
  await ensureInitialized();

  const url = new URL(request.url || "/", `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  const path = url.pathname;

  if (request.method === "GET" && path === "/health") {
    sendJson(response, 200, {
      ok: true,
      initialized: isInitialized,
      authMode,
      timestamp: nowIso(),
    });
    return;
  }

  if (request.method === "GET" && path === "/account/read") {
    const refreshToken = url.searchParams.get("refreshToken") === "1";
    const result = await sendRpc("account/read", { refreshToken });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && path === "/account/login/start") {
    const body = await parseBody(request);
    const type = String(body.type ?? "chatgpt").trim();

    if (type !== "chatgpt") {
      sendError(response, 400, "Only chatgpt login is supported by this bridge.");
      return;
    }

    const result = await sendRpc("account/login/start", { type: "chatgpt" });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && path === "/account/login/completed") {
    const loginId = url.searchParams.get("loginId");
    const key = loginId || "__NO_LOGIN_ID__";

    if (!loginCompletions.has(key)) {
      sendJson(response, 200, null);
      return;
    }

    sendJson(response, 200, loginCompletions.get(key));
    return;
  }

  if (request.method === "POST" && path === "/account/login/cancel") {
    const body = await parseBody(request);
    const loginId = String(body.loginId ?? "").trim();

    if (!loginId) {
      sendError(response, 400, "loginId is required.");
      return;
    }

    const result = await sendRpc("account/login/cancel", { loginId });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && path === "/account/logout") {
    const result = await sendRpc("account/logout", {});
    sendJson(response, 200, result);
    return;
  }

  const actionMatch = parseActionPath(path);
  if (request.method === "POST" && actionMatch) {
    if (actionMatch.stream) {
      await runActionTurnStreaming(actionMatch.action, request, response);
      return;
    }

    const body = await parseBody(request);
    const result = await runActionTurn(actionMatch.action, body);
    sendJson(response, 200, result);
    return;
  }

  // Backward compatibility for older worker wiring.
  if (request.method === "POST" && path === "/scenario/generate") {
    const body = await parseBody(request);
    const result = await runActionTurn("generate", body);
    sendJson(response, 200, result);
    return;
  }

  sendError(response, 404, "Route not found.");
};

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent) {
      try {
        response.end();
      } catch {
        // Best effort close for streaming failures.
      }
      return;
    }

    sendError(response, 500, error instanceof Error ? error.message : "Unknown bridge error.");
  });
});

server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  console.log(
    `[codex-auth-bridge] listening on http://${BRIDGE_HOST}:${BRIDGE_PORT} using ${CODEX_BIN} ${CODEX_ARGS.join(
      " ",
    )}`,
  );
});

const shutdown = () => {
  server.close(() => {
    codexProc.kill("SIGTERM");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
