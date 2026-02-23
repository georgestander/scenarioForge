import { env } from "cloudflare:workers";

interface BridgeAccountApiKey {
  type: "apiKey";
}

interface BridgeAccountChatGpt {
  type: "chatgpt";
  email?: string | null;
  planType?: string | null;
}

type BridgeAccount = BridgeAccountApiKey | BridgeAccountChatGpt;

interface BridgeAccountReadResponse {
  account: BridgeAccount | null;
  requiresOpenaiAuth: boolean;
}

interface BridgeLoginStartResponse {
  type: "chatgpt";
  loginId: string;
  authUrl: string;
}

interface BridgeLoginCompletedResponse {
  loginId: string | null;
  success: boolean;
  error: string | null;
}

interface BridgeErrorPayload {
  error?: string;
}

export interface ChatGptAccount {
  email: string | null;
  planType: string | null;
}

export interface ChatGptLoginStartResult {
  loginId: string;
  authUrl: string;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/g, "");

const getBridgeUrl = (): string => {
  const base = env.CODEX_AUTH_BRIDGE_URL?.trim();

  if (!base) {
    throw new Error(
      "ChatGPT sign-in bridge is not configured. Set CODEX_AUTH_BRIDGE_URL to your codex auth bridge endpoint.",
    );
  }

  return trimTrailingSlash(base);
};

const readBridgeError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as BridgeErrorPayload;
    return payload.error ?? `Bridge request failed with status ${response.status}.`;
  } catch {
    return `Bridge request failed with status ${response.status}.`;
  }
};

const bridgeFetchJson = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const bridgeUrl = getBridgeUrl();
  let response: Response;

  try {
    response = await fetch(`${bridgeUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      `Unable to reach ChatGPT auth bridge at ${bridgeUrl}. Start it with 'pnpm dev:auth-bridge'.`,
    );
  }

  if (!response.ok) {
    throw new Error(await readBridgeError(response));
  }

  return (await response.json()) as T;
};

export const startChatGptLogin = async (): Promise<ChatGptLoginStartResult> => {
  const payload = await bridgeFetchJson<BridgeLoginStartResponse>("/account/login/start", {
    method: "POST",
    body: JSON.stringify({ type: "chatgpt" }),
  });

  if (!payload.loginId || !payload.authUrl) {
    throw new Error("Bridge returned an invalid ChatGPT login payload.");
  }

  return {
    loginId: payload.loginId,
    authUrl: payload.authUrl,
  };
};

export const readChatGptAccount = async (
  refreshToken = false,
): Promise<ChatGptAccount | null> => {
  const payload = await bridgeFetchJson<BridgeAccountReadResponse>(
    `/account/read?refreshToken=${refreshToken ? "1" : "0"}`,
    {
      method: "GET",
    },
  );

  if (payload.account?.type !== "chatgpt") {
    return null;
  }

  return {
    email: payload.account.email?.trim().toLowerCase() ?? null,
    planType: payload.account.planType ?? null,
  };
};

export const readChatGptLoginCompletion = async (
  loginId: string,
): Promise<BridgeLoginCompletedResponse | null> => {
  const trimmed = loginId.trim();

  if (!trimmed) {
    return null;
  }

  return bridgeFetchJson<BridgeLoginCompletedResponse | null>(
    `/account/login/completed?loginId=${encodeURIComponent(trimmed)}`,
    {
      method: "GET",
    },
  );
};

export const cancelChatGptLogin = async (loginId: string): Promise<void> => {
  const trimmed = loginId.trim();

  if (!trimmed) {
    throw new Error("loginId is required.");
  }

  await bridgeFetchJson<Record<string, never>>("/account/login/cancel", {
    method: "POST",
    body: JSON.stringify({ loginId: trimmed }),
  });
};

export const logoutChatGpt = async (): Promise<void> => {
  await bridgeFetchJson<Record<string, never>>("/account/logout", {
    method: "POST",
  });
};
