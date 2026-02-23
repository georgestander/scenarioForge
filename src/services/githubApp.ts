import { env } from "cloudflare:workers";
import type { GitHubRepository } from "@/domain/models";

const CONNECT_STATE_KEY = "__SCENARIOFORGE_GITHUB_CONNECT_STATE__";
const STATE_TTL_MS = 10 * 60 * 1000;

interface ConnectStateRecord {
  principalId: string;
  expiresAt: number;
}

interface ConnectStateStore {
  records: Map<string, ConnectStateRecord>;
}

interface InstallationDetailsResponse {
  account?: {
    login?: string;
  };
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string | null;
}

interface InstallationRepositoriesResponse {
  repositories?: Array<{
    id: number;
    name: string;
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
  }>;
}

interface AppInstallationSummary {
  id: number;
  account?: {
    login?: string | null;
  };
}

const getConnectStateStore = (): ConnectStateStore => {
  const host = globalThis as typeof globalThis & {
    [CONNECT_STATE_KEY]?: ConnectStateStore;
  };

  if (!host[CONNECT_STATE_KEY]) {
    host[CONNECT_STATE_KEY] = {
      records: new Map<string, ConnectStateRecord>(),
    };
  }

  return host[CONNECT_STATE_KEY];
};

const normalizePrivateKey = (value: string): string =>
  value.replace(/\\n/g, "\n").trim();

const toBase64Url = (input: Uint8Array): string => {
  let binary = "";

  for (let index = 0; index < input.length; index += 1) {
    binary += String.fromCharCode(input[index]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const toBase64UrlString = (value: string): string =>
  toBase64Url(new TextEncoder().encode(value));

const pemToArrayBuffer = (pem: string): ArrayBuffer => {
  const normalized = pem
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "")
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const decoded = atob(normalized);
  const output = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    output[index] = decoded.charCodeAt(index);
  }

  return output.buffer;
};

const getGitHubAppConfig = () => {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();

  if (!appId || !privateKey) {
    throw new Error(
      "GitHub App credentials missing. Configure GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.",
    );
  }

  return {
    appId,
    privateKey: normalizePrivateKey(privateKey),
  };
};

const createGitHubAppJwt = async (): Promise<string> => {
  const { appId, privateKey } = getGitHubAppConfig();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  };

  const signingInput = `${toBase64UrlString(JSON.stringify(header))}.${toBase64UrlString(
    JSON.stringify(payload),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
};

const githubHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ScenarioForge",
});

const readErrorMessage = async (response: Response): Promise<string> => {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as { message?: string };
    return parsed.message ?? body;
  } catch {
    return body;
  }
};

const githubApiRequest = async <T>(
  path: string,
  init: RequestInit,
): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, init);

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(`GitHub API request failed: ${response.status} ${message}`);
  }

  return (await response.json()) as T;
};

const mapRepositories = (
  payload: InstallationRepositoriesResponse,
): GitHubRepository[] => {
  return (payload.repositories ?? []).map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
    url: repo.html_url,
  }));
};

export const issueGitHubConnectState = (principalId: string): string => {
  const state = crypto.randomUUID();

  getConnectStateStore().records.set(state, {
    principalId,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  return state;
};

export const consumeGitHubConnectState = (
  state: string,
  principalId: string,
): boolean => {
  const store = getConnectStateStore();
  const record = store.records.get(state);

  store.records.delete(state);

  if (!record) {
    return false;
  }

  if (record.expiresAt < Date.now()) {
    return false;
  }

  return record.principalId === principalId;
};

export const getGitHubInstallUrl = (state: string): string => {
  const configuredInstallUrl = env.GITHUB_APP_INSTALL_URL?.trim();

  if (configuredInstallUrl) {
    const url = new URL(configuredInstallUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  const appSlug = env.GITHUB_APP_SLUG?.trim();

  if (!appSlug) {
    throw new Error(
      "GitHub install URL missing. Configure GITHUB_APP_SLUG or GITHUB_APP_INSTALL_URL.",
    );
  }

  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
};

export const connectGitHubInstallation = async (installationId: number) => {
  const appJwt = await createGitHubAppJwt();

  const installation = await githubApiRequest<InstallationDetailsResponse>(
    `/app/installations/${installationId}`,
    {
      method: "GET",
      headers: githubHeaders(appJwt),
    },
  );

  const tokenPayload = await githubApiRequest<InstallationTokenResponse>(
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubHeaders(appJwt),
    },
  );

  const reposPayload = await githubApiRequest<InstallationRepositoriesResponse>(
    "/installation/repositories?per_page=100",
    {
      method: "GET",
      headers: githubHeaders(tokenPayload.token),
    },
  );

  return {
    accountLogin: installation.account?.login ?? null,
    accessToken: tokenPayload.token,
    accessTokenExpiresAt: tokenPayload.expires_at,
    repositories: mapRepositories(reposPayload),
  };
};

const normalizeOwnerHint = (value: string): string => value.trim().toLowerCase();

export const findRecoverableGitHubInstallationId = async (
  ownerHints: string[],
): Promise<number | null> => {
  const appJwt = await createGitHubAppJwt();
  const installationsPayload = await githubApiRequest<
    AppInstallationSummary[] | { installations?: AppInstallationSummary[] }
  >("/app/installations?per_page=100", {
    method: "GET",
    headers: githubHeaders(appJwt),
  });

  const installations = Array.isArray(installationsPayload)
    ? installationsPayload
    : installationsPayload.installations ?? [];

  if (installations.length === 0) {
    return null;
  }

  const normalizedHints = new Set(
    ownerHints
      .map((hint) => normalizeOwnerHint(hint))
      .filter((hint) => hint.length > 0),
  );

  if (normalizedHints.size > 0) {
    const matched = installations.find((installation) => {
      const login = installation.account?.login ?? "";
      return normalizedHints.has(normalizeOwnerHint(login));
    });

    if (matched && Number.isInteger(matched.id) && matched.id > 0) {
      return matched.id;
    }
  }

  if (installations.length === 1) {
    const only = installations[0];
    if (only && Number.isInteger(only.id) && only.id > 0) {
      return only.id;
    }
  }

  return null;
};
