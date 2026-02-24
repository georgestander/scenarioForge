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
      minHeight: "100dvh",
      maxWidth: "720px",
      margin: "0 auto",
      padding: "2rem 1rem",
      display: "grid",
      gap: "1.5rem",
      alignContent: "start",
    }}>
      <section style={{ display: "grid", gap: "0.12rem" }}>
        <p style={{
          margin: 0,
          fontSize: "0.88rem",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--forge-fire)",
        }}>
          ScenarioForge
        </p>
        <h1 style={{
          margin: 0,
          fontFamily: "'VT323', monospace",
          fontSize: "clamp(2.5rem, 5vw, 4rem)",
          letterSpacing: "0.05em",
          lineHeight: 1,
          color: "var(--forge-hot)",
          textShadow: "0 0 16px rgb(242 138 67 / 0.22)",
        }}>
          Scenario-Driven Collaboration
        </h1>
        <p style={{ margin: "0.5rem 0 0", fontSize: "1.05rem", color: "var(--forge-muted)", lineHeight: 1.5 }}>
          Generate realistic scenarios from trusted sources, run them, auto-fix failures with Codex,
          and ship review-ready pull requests — all from a single mission control.
        </p>
      </section>

      <section style={{
        border: "1px solid var(--forge-line)",
        background: "var(--forge-panel)",
        borderRadius: "12px",
        padding: "1.2rem",
        boxShadow: "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
      }}>
        <h2 style={{
          margin: "0 0 0.75rem",
          fontFamily: "'VT323', monospace",
          fontSize: "1.65rem",
          color: "var(--forge-hot)",
        }}>
          Get Started
        </h2>
        <SignInPanel />
      </section>

      <section style={{ display: "grid", gap: "0.6rem" }}>
        <h2 style={{
          margin: 0,
          fontFamily: "'VT323', monospace",
          fontSize: "1.45rem",
          color: "var(--forge-hot)",
        }}>
          How It Works
        </h2>
        <ol style={{
          margin: 0,
          paddingLeft: "1.2rem",
          color: "var(--forge-muted)",
          fontSize: "0.92rem",
          lineHeight: 1.6,
          display: "grid",
          gap: "0.4rem",
        }}>
          <li><strong style={{ color: "var(--forge-ink)" }}>Connect</strong> — Link your GitHub repo and select a branch</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Select Sources</strong> — Scan and trust-gate your planning docs</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Generate</strong> — Build scenario packs grouped by feature and outcome</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Review</strong> — Inspect scenarios, personas, edge variants, and pass criteria</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Execute</strong> — Run scenarios, auto-fix failures, and create PRs</li>
          <li><strong style={{ color: "var(--forge-ink)" }}>Complete</strong> — Review results, export reports, ship confidently</li>
        </ol>
      </section>
    </main>
  );
};
