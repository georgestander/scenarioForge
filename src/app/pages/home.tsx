import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import { SignInPanel } from "./SignInPanel";

type AppRequestInfo = RequestInfo<any, AppContext>;

export const Home = ({ ctx }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (principal) {
    return redirect("/dashboard");
  }

  return (
    <main style={{
      boxSizing: "border-box",
      height: "100dvh",
      maxWidth: "720px",
      margin: "0 auto",
      padding: "1rem",
      display: "grid",
      gridTemplateRows: "auto auto auto",
      gap: "0.75rem",
      overflow: "hidden",
      position: "relative",
      isolation: "isolate",
      alignContent: "start",
    }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          borderRadius: "14px",
          backgroundImage: "url('/scenarioForge.png')",
          backgroundSize: "82% auto",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center 40%",
          filter: "saturate(1.16) contrast(1.08) brightness(1.18)",
          opacity: 0.95,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          borderRadius: "14px",
          background:
            "linear-gradient(180deg, rgba(6,10,21,0.18) 0%, rgba(6,10,21,0.36) 100%)",
          backdropFilter: "blur(0.2px)",
          pointerEvents: "none",
        }}
      />

      <section style={{ display: "grid", gap: "0.12rem", position: "relative", zIndex: 1 }}>
        <p style={{
          margin: 0,
          fontSize: "0.8rem",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--forge-fire)",
        }}>
          Scenario Forge
        </p>
        <h1 style={{
          margin: 0,
          fontFamily: "'VT323', monospace",
          fontSize: "clamp(2rem, 4.5vw, 3.1rem)",
          letterSpacing: "0.05em",
          lineHeight: 1,
          color: "var(--forge-hot)",
          textShadow: "0 0 18px rgb(242 138 67 / 0.28)",
        }}>
          Scenario-Driven Collaboration
        </h1>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.9rem", color: "var(--forge-ink)", lineHeight: 1.35 }}>
          Scenario Forge generates real user scenarios from your app logic, selected docs, and edge cases,
          then runs them in-repo with Codex so you can ship with evidence.
        </p>
      </section>

      <section style={{
        border: "1px solid var(--forge-line)",
        background: "rgba(18, 24, 43, 0.62)",
        borderRadius: "12px",
        padding: "0.9rem",
        boxShadow:
          "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
        backdropFilter: "blur(1px)",
        position: "relative",
        zIndex: 1,
      }}>
        <h2 style={{
          margin: "0 0 0.5rem",
          fontFamily: "'VT323', monospace",
          fontSize: "1.45rem",
          color: "var(--forge-hot)",
        }}>
          Get Started
        </h2>
        <SignInPanel />
      </section>

      <section style={{
        position: "relative",
        zIndex: 1,
        border: "1px solid var(--forge-line)",
        background: "rgba(18, 24, 43, 0.58)",
        borderRadius: "12px",
        padding: "0.75rem 0.85rem",
        boxShadow:
          "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
        backdropFilter: "blur(1px)",
        minHeight: 0,
        display: "grid",
        gap: "0.35rem",
        alignContent: "start",
      }}>
        <h2 style={{
          margin: 0,
          fontFamily: "'VT323', monospace",
          fontSize: "1.25rem",
          color: "var(--forge-hot)",
        }}>
          How It Works
        </h2>
        <ol style={{
          margin: 0,
          paddingLeft: "1rem",
          color: "var(--forge-ink)",
          fontSize: "0.82rem",
          lineHeight: 1.35,
          display: "grid",
          alignContent: "start",
          gap: "0.2rem",
          overflow: "hidden",
        }}>
          <li><strong style={{ color: "var(--forge-ink)" }}>Connect</strong> — Link your GitHub repo and branch</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Generate</strong> — Use app logic + docs + edge cases for real scenarios</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Review</strong> — Approve concrete user journeys with binary pass criteria</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Execute</strong> — Run, fix, rerun, and export evidence-backed outcomes</li>
        </ol>
      </section>
    </main>
  );
};
