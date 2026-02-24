"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { AuthPrincipal } from "@/domain/models";
import { readError } from "./api.js";

interface SessionContextValue {
  authPrincipal: AuthPrincipal | null;
  setAuthPrincipal: (principal: AuthPrincipal | null) => void;
  statusMessage: string;
  setStatusMessage: (message: string) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const DEFAULT_STATUS_MESSAGE =
  "Follow the mission sequence: connect -> select -> generate/update -> execute -> review.";

export const useSession = (): SessionContextValue => {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
};

export const SessionProvider = ({
  children,
  initialPrincipal,
}: {
  children: React.ReactNode;
  initialPrincipal?: AuthPrincipal | null;
}) => {
  const [authPrincipal, setAuthPrincipal] = useState<AuthPrincipal | null>(
    initialPrincipal ?? null,
  );
  const [statusMessage, setStatusMessage] = useState(
    DEFAULT_STATUS_MESSAGE,
  );

  const signOut = useCallback(async () => {
    const response = await fetch("/api/auth/sign-out", { method: "POST" });
    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to sign out."));
      return;
    }

    setAuthPrincipal(null);
    setStatusMessage("Signed out.");
  }, []);

  return (
    <SessionContext.Provider
      value={{
        authPrincipal,
        setAuthPrincipal,
        statusMessage,
        setStatusMessage,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};
