"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readError } from "@/app/shared/api";
import { openInNewTab } from "@/app/shared/api";
import type {
  ChatGptSignInStartPayload,
  ChatGptSignInCompletePayload,
  ChatGptSignInStatusPayload,
} from "@/app/shared/types";

const CHATGPT_LOGIN_STORAGE_KEY = "sf_chatgpt_login_id";
const CHATGPT_LOGIN_URL_STORAGE_KEY = "sf_chatgpt_login_url";

export const SignInPanel = () => {
  const [loginId, setLoginId] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const loginIdRef = useRef<string | null>(null);

  const setLoginState = useCallback(
    (id: string | null, isPending: boolean, authUrl?: string | null) => {
      loginIdRef.current = id;
      setLoginId(id);
      setPending(isPending);
      if (typeof authUrl !== "undefined") {
        setLoginUrl(authUrl);
      } else if (!isPending) {
        setLoginUrl(null);
      }

      try {
        if (id && isPending) {
          window.sessionStorage.setItem(CHATGPT_LOGIN_STORAGE_KEY, id);
        } else {
          window.sessionStorage.removeItem(CHATGPT_LOGIN_STORAGE_KEY);
        }

        if (authUrl && isPending) {
          window.sessionStorage.setItem(CHATGPT_LOGIN_URL_STORAGE_KEY, authUrl);
        } else if (!isPending || authUrl === null) {
          window.sessionStorage.removeItem(CHATGPT_LOGIN_URL_STORAGE_KEY);
        }
      } catch {
        // Ignore storage errors in private browsing.
      }
    },
    [],
  );

  const completeChatGptSignIn = useCallback(
    async (currentLoginId: string): Promise<boolean> => {
      const response = await fetch("/api/auth/chatgpt/sign-in/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: currentLoginId }),
      });

      if (response.status === 202) {
        return false;
      }

      if (!response.ok) {
        setMessage(await readError(response, "Failed to complete ChatGPT sign-in."));
        return false;
      }

      const payload = (await response.json()) as ChatGptSignInCompletePayload;
      if (!payload.authenticated) {
        return false;
      }

      setLoginState(null, false);
      // Full navigation — server re-checks auth
      window.location.href = "/dashboard";
      return true;
    },
    [setLoginState],
  );

  const pollForChatGptSignIn = useCallback(
    (currentLoginId: string) => {
      let attempts = 0;
      const maxAttempts = 45;

      const run = async () => {
        if (loginIdRef.current !== currentLoginId) {
          return;
        }

        attempts += 1;
        const completed = await completeChatGptSignIn(currentLoginId);

        if (completed) {
          return;
        }

        // Check status
        const statusRes = await fetch(
          `/api/auth/chatgpt/sign-in/status?loginId=${encodeURIComponent(currentLoginId)}`,
        );
        if (statusRes.ok) {
          const statusPayload = (await statusRes.json()) as ChatGptSignInStatusPayload;
          if (statusPayload.completed && !statusPayload.completed.success) {
            setLoginState(null, false);
            setMessage(
              statusPayload.completed.error
                ? `ChatGPT sign-in failed (${statusPayload.completed.error}).`
                : "ChatGPT sign-in did not complete.",
            );
            return;
          }
        }

        if (attempts < maxAttempts) {
          window.setTimeout(run, 2000);
          return;
        }

        setMessage(
          "Still waiting for ChatGPT sign-in. Finish sign-in in the opened tab, then click Complete ChatGPT Sign-In.",
        );
      };

      window.setTimeout(run, 2000);
    },
    [completeChatGptSignIn, setLoginState],
  );

  // Restore pending login on mount
  useEffect(() => {
    const pendingId = window.sessionStorage.getItem(CHATGPT_LOGIN_STORAGE_KEY);
    const pendingUrl = window.sessionStorage.getItem(CHATGPT_LOGIN_URL_STORAGE_KEY);

    if (pendingId) {
      setLoginState(pendingId, true, pendingUrl ?? null);
      setMessage("Resuming pending ChatGPT sign-in.");
      void completeChatGptSignIn(pendingId).then((completed) => {
        if (!completed) {
          pollForChatGptSignIn(pendingId);
        }
      });
    }
  }, [setLoginState, completeChatGptSignIn, pollForChatGptSignIn]);

  const handleSignIn = async () => {
    const response = await fetch("/api/auth/chatgpt/sign-in", { method: "POST" });

    if (!response.ok) {
      setMessage(await readError(response, "Failed to start ChatGPT sign-in."));
      return;
    }

    const payload = (await response.json()) as ChatGptSignInStartPayload;

    if (!payload.authUrl || !payload.loginId) {
      setMessage("ChatGPT sign-in URL is unavailable.");
      return;
    }

    setLoginState(payload.loginId, true, payload.authUrl);

    const result = openInNewTab(payload.authUrl, "ChatGPT sign-in");

    if (result === "blocked") {
      setMessage(
        "Pop-up blocked. Click Open ChatGPT Sign-In Tab below.",
      );
      return;
    }

    setMessage(
      "Opened ChatGPT sign-in in a new tab. Finish the login there; this page will auto-complete when done.",
    );
    pollForChatGptSignIn(payload.loginId);
  };

  const handleOpenTab = () => {
    if (!loginUrl || !loginId) {
      setMessage("Start ChatGPT sign-in first.");
      return;
    }

    const result = openInNewTab(loginUrl, "ChatGPT sign-in");
    if (result === "blocked") {
      setMessage("Pop-up still blocked. Allow pop-ups for this site.");
      return;
    }

    setMessage("Opened ChatGPT sign-in in a new tab. Finish login there, then return here.");
    pollForChatGptSignIn(loginId);
  };

  const handleComplete = async () => {
    if (!loginId) {
      setMessage("Start ChatGPT sign-in first.");
      return;
    }

    const completed = await completeChatGptSignIn(loginId);
    if (!completed) {
      setMessage("ChatGPT sign-in is still in progress. Complete it in the opened tab and retry.");
    }
  };

  const handleCancel = async () => {
    if (!loginId) {
      setLoginState(null, false);
      return;
    }

    await fetch("/api/auth/chatgpt/sign-in/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId }),
    });

    setLoginState(null, false);
    setMessage("ChatGPT sign-in cancelled.");
  };

  return (
    <div style={{ display: "grid", gap: "0.55rem" }}>
      {message ? (
        <p style={{
          margin: 0,
          border: "1px solid #6a452f",
          borderRadius: "10px",
          background: "linear-gradient(180deg, rgb(163 87 46 / 0.22) 0%, rgb(97 53 29 / 0.18) 100%)",
          padding: "0.6rem 0.75rem",
          color: "var(--forge-ink)",
          fontSize: "0.9rem",
        }}>
          {message}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button type="button" onClick={() => void handleSignIn()} disabled={pending}>
          {pending ? "Waiting for ChatGPT..." : "Sign In With ChatGPT"}
        </button>
        <button
          type="button"
          onClick={() => void handleComplete()}
          disabled={!pending}
          style={{
            borderColor: "#3f557f",
            background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
          }}
        >
          Complete ChatGPT Sign-In
        </button>
      </div>

      {pending ? (
        <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <button
            type="button"
            onClick={handleOpenTab}
            disabled={!loginUrl}
            style={{
              borderColor: "#3f557f",
              background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
            }}
          >
            Open ChatGPT Sign-In Tab
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            style={{
              borderColor: "#3f557f",
              background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
            }}
          >
            Cancel ChatGPT Sign-In
          </button>
        </div>
      ) : null}
    </div>
  );
};
