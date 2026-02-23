#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import readline from "node:readline";

const npmExecPath = process.env.npm_execpath;

const runScript = (script, options = {}) => {
  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, "run", script], {
      cwd: process.cwd(),
      env: process.env,
      ...options,
    });
  }

  return spawn("npm", ["run", script], {
    cwd: process.cwd(),
    env: process.env,
    ...options,
  });
};

const prefixOutput = (stream, prefix) => {
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    process.stdout.write(`[${prefix}] ${line}\n`);
  });
};

const stopProcess = (child) => {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGINT");
};

const bridge = runScript("dev:auth-bridge", {
  stdio: ["ignore", "pipe", "pipe"],
});

prefixOutput(bridge.stdout, "auth");
prefixOutput(bridge.stderr, "auth");

let app = null;
let shuttingDown = false;
let bridgeReady = false;

const shutdown = (code = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopProcess(app);
  stopProcess(bridge);
  process.exit(code);
};

const startApp = () => {
  if (app) {
    return;
  }

  app = runScript("dev:app", {
    stdio: "inherit",
  });

  app.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      shutdown(1);
      return;
    }

    shutdown(code ?? 0);
  });
};

bridge.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");

  if (text.includes("listening on http://127.0.0.1:4319")) {
    bridgeReady = true;
    startApp();
  }
});

bridge.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf8");

  if (text.includes("EADDRINUSE")) {
    bridgeReady = true;
    startApp();
  }
});

bridge.on("exit", (code, signal) => {
  if (shuttingDown) {
    return;
  }

  if (!bridgeReady) {
    process.stderr.write(
      "\nFailed to start ChatGPT auth bridge. Run `pnpm dev:auth-bridge` to inspect logs.\n",
    );
    shutdown(1);
    return;
  }

  if (signal || code !== 0) {
    process.stderr.write(
      "\nChatGPT auth bridge exited unexpectedly; stopping dev server.\n",
    );
    shutdown(1);
  }
});

setTimeout(() => {
  if (!bridgeReady) {
    process.stderr.write(
      "\nTimed out waiting for ChatGPT auth bridge to become ready.\n",
    );
    shutdown(1);
  }
}, 15000);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
