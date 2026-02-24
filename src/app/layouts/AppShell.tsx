import type { LayoutProps } from "rwsdk/router";
import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getGitHubConnectionForPrincipal,
  getLatestSourceManifestForProject,
  listScenarioPacksForProject,
  listScenarioRunsForProject,
  getProjectByIdForOwner,
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
  const project = projectId ? getProjectByIdForOwner(projectId, principal.id) : null;

  // Progress bar: count done phases
  const doneCount = phases.filter((p) => p.done).length;
  const activePhaseIndex = phases.findIndex((p) => p.path === currentPath);
  const activePhase = activePhaseIndex >= 0 ? phases[activePhaseIndex] : null;
  const progressCount =
    phases.length > 0
      ? Math.max(doneCount, activePhaseIndex >= 0 ? activePhaseIndex + 1 : doneCount)
      : 0;
  const progressPct = phases.length > 0 ? Math.round((progressCount / phases.length) * 100) : 0;

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
          {/* Header */}
          <section style={{ display: "grid", gap: "0.15rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
              <div style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "var(--forge-line)",
                display: "grid",
                placeItems: "center",
                fontSize: "0.85rem",
                color: "var(--forge-muted)",
                flexShrink: 0,
              }}>
                {principal.displayName?.charAt(0)?.toUpperCase() ?? "?"}
              </div>
              <span style={{
                fontFamily: "'VT323', monospace",
                fontSize: "1.35rem",
                color: "var(--forge-hot)",
                letterSpacing: "0.04em",
              }}>
                Scenario Forge
              </span>
            </div>

            {/* Progress bar */}
            {!isDashboard && phases.length > 0 ? (
              <div style={{ display: "grid", gap: "0.28rem", marginTop: "0.3rem" }}>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--forge-muted)" }}>
                  {activePhase
                    ? `Current phase ${activePhase.id} of ${phases.length}: ${activePhase.label}`
                    : `Progress: ${progressCount} of ${phases.length} phases`}
                </p>
                <div style={{
                  height: "8px",
                  borderRadius: "4px",
                  background: "var(--forge-line)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${progressPct}%`,
                    borderRadius: "4px",
                    background: "var(--forge-hot)",
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            ) : null}

            {/* Repo / Branch info */}
            {!isDashboard && project ? (
              <p style={{ margin: "0.15rem 0 0", fontSize: "0.82rem", color: "var(--forge-muted)" }}>
                Repo: <strong style={{ color: "var(--forge-ink)" }}>{project.repoUrl ?? "Not set"}</strong>
                {" | "}
                Branch: <strong style={{ color: "var(--forge-ink)" }}>{project.defaultBranch}</strong>
              </p>
            ) : null}

            {isDashboard ? (
              <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--forge-muted)" }}>
                {principal.displayName}{principal.email ? ` (${principal.email})` : ""}
                {" | "}
                <a href="/dashboard" style={{ color: "var(--forge-fire)", textDecoration: "none" }}>Dashboard</a>
              </p>
            ) : null}
          </section>

          {isDashboard ? (
            <section style={{ minHeight: 0, overflow: "auto" }}>
              {children}
            </section>
          ) : (
            <section style={{
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: "200px minmax(0, 1fr)",
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
