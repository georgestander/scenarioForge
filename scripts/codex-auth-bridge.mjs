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

let requestId = 1;
let isInitialized = false;
let authMode = null;
let initializePromise = null;

const pendingRequests = new Map();
const loginCompletions = new Map();
const turnCompletionWatchers = new Map();
const completedTurns = new Map();
const turnAgentMessages = new Map();

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

const captureTurnAgentMessage = (turnId, text) => {
  const normalizedTurnId = readString(turnId);
  const normalizedText = readString(text);

  if (!normalizedTurnId || !normalizedText) {
    return;
  }

  turnAgentMessages.set(normalizedTurnId, normalizedText);
};

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

const consumeNotification = (message) => {
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
    if (item?.type === "agentMessage") {
      captureTurnAgentMessage(message.params?.turnId, item?.text);
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

  if (Object.prototype.hasOwnProperty.call(message, "id")) {
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

const readString = (value) => (typeof value === "string" ? value.trim() : "");

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

const assertAuthenticated = async () => {
  const account = await sendRpc("account/read", { refreshToken: true });
  const requiresAuth = Boolean(account?.requiresOpenaiAuth);
  const hasAccount = Boolean(account?.account);

  if (requiresAuth && !hasAccount) {
    throw new Error(
      "ChatGPT sign-in is required in Stage 1 before scenario generation can run.",
    );
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
    if (item?.type === "agentMessage" && typeof item?.text === "string") {
      finalText = item.text;
    }
  });

  return finalText.trim();
};

const runScenarioGenerationTurn = async (body) => {
  const prompt = readString(body?.prompt);
  if (!prompt) {
    throw new Error("prompt is required.");
  }

  await assertAuthenticated();

  const requestedModel = readString(body?.model) || "codex spark";
  const resolvedModel = await resolveModelId(requestedModel);
  const model = resolvedModel.selected;
  const cwd = readString(body?.cwd) || process.cwd();
  const requestedSkillName = readString(body?.skillName);
  const outputSchema =
    body?.outputSchema && typeof body.outputSchema === "object"
      ? body.outputSchema
      : null;
  const approvalPolicy = readString(body?.approvalPolicy) || "never";
  const threadSandbox = readString(body?.sandbox) || "workspace-write";
  const sandboxPolicy =
    body?.sandboxPolicy && typeof body.sandboxPolicy === "object"
      ? body.sandboxPolicy
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
    : "Scenario generation request: ";
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

  const threadResult = await sendRpc("thread/start", {
    model,
    cwd,
    approvalPolicy,
    sandbox: threadSandbox,
  });
  const threadId = extractThreadId(threadResult);

  if (!threadId) {
    throw new Error("Failed to create a Codex thread for scenario generation.");
  }

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
    throw new Error("Codex did not return a turn id for scenario generation.");
  }

  try {
    let completedTurn = null;
    try {
      completedTurn = await waitForTurnCompletion(turnId, turnTimeoutMs);
    } catch {
      completedTurn = null;
    }

    let finalTurn = completedTurn;
    try {
      const threadRead = await sendRpc("thread/read", {
        threadId,
        includeTurns: true,
      });
      const readTurn = extractTurnFromThreadRead(threadRead, turnId);
      if (readTurn) {
        finalTurn = readTurn;
      }
    } catch {
      // Keep notification-derived turn if thread/read is unavailable.
    }

    const turnStatus = readString(finalTurn?.status) || "completed";
    const turnErrorMessage = parseTurnErrorMessage(finalTurn?.error?.message);
    const responseText =
      readString(turnAgentMessages.get(turnId)) ||
      extractAgentMessageText(finalTurn?.items ?? []);

    if (turnStatus === "failed") {
      throw new Error(
        turnErrorMessage ||
          "Codex scenario generation turn failed without a detailed error message.",
      );
    }

    if (!responseText) {
      throw new Error(
        turnErrorMessage ||
          "Codex completed the turn but did not emit an agentMessage text payload.",
      );
    }

    return {
      model,
      cwd,
      threadId,
      turnId,
      turnStatus,
      skillRequested: skillResolution.requested ?? (requestedSkillName || "none"),
      skillAvailable: skillResolution.available,
      skillUsed: skillResolution.available ? requestedSkillName : null,
      skillPath: skillResolution.selected?.path ?? null,
      responseText,
      completedAt: nowIso(),
    };
  } finally {
    turnAgentMessages.delete(turnId);
    completedTurns.delete(turnId);
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
          version: "0.1.0",
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

  if (request.method === "POST" && path === "/scenario/generate") {
    const body = await parseBody(request);
    const result = await runScenarioGenerationTurn(body);
    sendJson(response, 200, result);
    return;
  }

  sendError(response, 404, "Route not found.");
};

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
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
