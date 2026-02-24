"use client";

import { useState } from "react";
import { useSession } from "@/app/shared/SessionContext";

export const SignOutButton = () => {
  const { signOut } = useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    try {
      await signOut();
      window.location.href = "/";
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={isSigningOut}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.42rem 0.72rem",
        borderRadius: "7px",
        border: "1px solid #3f557f",
        color: "var(--forge-ink)",
        background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
        fontSize: "0.8rem",
        fontWeight: 600,
      }}
    >
      {isSigningOut ? "Signing Out..." : "Sign Out"}
    </button>
  );
};
