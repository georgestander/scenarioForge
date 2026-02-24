import type { LayoutProps } from "rwsdk/router";
import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getGitHubConnectionForPrincipal,
  getLatestSourceManifestForProject,
  listScenarioPacksForProject,
  listScenarioRunsForProject,
} from "@/services/store";
import { SessionProvider } from "@/app/shared/SessionContext";
import { ProjectProvider } from "@/app/shared/ProjectContext";
import { PhaseRail } from "./PhaseRail";

type AppRequestInfo = RequestInfo<{ projectId?: string }, AppContext>;

const buildPhases = (
  projectId: string,
  principalId: string,
) => {
  const connection = getGitHubConnectionForPrincipal(principalId);
  const hasGitHub = Boolean(connection && connection.status === "connected");
  const manifest = getLatestSourceManifestForProject(principalId, projectId);
  const hasManifest = Boolean(manifest);
  const packs = listScenarioPacksForProject(principalId, projectId);
  const hasPacks = packs.length > 0;
  const runs = listScenarioRunsForProject(principalId, projectId);
  const hasRuns = runs.length > 0;

  return [
    {
      id: 1,
      label: "Connect",
      path: `/projects/${projectId}/connect`,
      unlocked: true,
      done: hasGitHub,
    },
    {
      id: 2,
      label: "Sources",
      path: `/projects/${projectId}/sources`,
      unlocked: hasGitHub,
      done: hasManifest,
    },
    {
      id: 3,
      label: "Generate",
      path: `/projects/${projectId}/generate`,
      unlocked: hasManifest,
      done: hasPacks,
    },
    {
      id: 4,
      label: "Review",
      path: `/projects/${projectId}/review`,
      unlocked: hasPacks,
      done: hasPacks,
    },
    {
      id: 5,
      label: "Execute",
      path: `/projects/${projectId}/execute`,
      unlocked: hasPacks,
      done: hasRuns,
    },
    {
      id: 6,
      label: "Completed",
      path: `/projects/${projectId}/completed`,
      unlocked: hasRuns,
      done: hasRuns,
    },
  ];
};

export const AppShell = ({ children, requestInfo }: LayoutProps<AppRequestInfo>) => {
  const principal = requestInfo?.ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const projectId = requestInfo?.params?.projectId ?? "";
  const currentPath = requestInfo?.path ?? "";
  const isDashboard = currentPath === "/dashboard";

  const phases = projectId ? buildPhases(projectId, principal.id) : [];

  return (
    <SessionProvider initialPrincipal={principal}>
      <ProjectProvider>
        <main style={{
          boxSizing: "border-box",
          height: "100dvh",
          maxWidth: "1320px",
          margin: "0 auto",
          padding: "0.85rem 1rem 1rem",
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          gap: "0.65rem",
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
              fontSize: "clamp(2.05rem, 4.5vw, 3.4rem)",
              letterSpacing: "0.05em",
              lineHeight: 1,
              color: "var(--forge-hot)",
              textShadow: "0 0 16px rgb(242 138 67 / 0.22)",
            }}>
              Mission Control
            </h1>
            <p style={{ margin: 0, fontSize: "0.95rem", color: "var(--forge-muted)" }}>
              {principal.displayName}{principal.email ? ` (${principal.email})` : ""}
              {" | "}
              <a href="/dashboard" style={{ color: "var(--forge-fire)", textDecoration: "none" }}>Dashboard</a>
            </p>
          </section>

          {isDashboard ? (
            <section style={{ minHeight: 0, overflow: "auto" }}>
              {children}
            </section>
          ) : (
            <section style={{
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: "240px minmax(0, 1fr)",
              gap: "0.75rem",
            }}>
              <aside style={{
                minHeight: 0,
                border: "1px solid var(--forge-line)",
                background: "var(--forge-panel)",
                borderRadius: "12px",
                padding: "0.8rem",
                overflow: "auto",
                boxShadow: "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
              }}>
                <PhaseRail
                  projectId={projectId}
                  phases={phases}
                  activePath={currentPath}
                />
              </aside>
              <article style={{
                minHeight: 0,
                border: "1px solid var(--forge-line)",
                background: "var(--forge-panel)",
                borderRadius: "12px",
                padding: "0.8rem",
                overflow: "auto",
                boxShadow: "0 14px 24px rgb(0 0 0 / 0.32), inset 0 0 0 1px rgb(242 138 67 / 0.08)",
              }}>
                {children}
              </article>
            </section>
          )}
        </main>
      </ProjectProvider>
    </SessionProvider>
  );
};
