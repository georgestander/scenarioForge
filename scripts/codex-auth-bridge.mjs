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

let requestId = 1;
let isInitialized = false;
let authMode = null;
let initializePromise = null;

const pendingRequests = new Map();
const loginCompletions = new Map();

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
