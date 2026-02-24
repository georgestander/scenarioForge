"use client";

interface Phase {
  id: number;
  label: string;
  path: string;
  unlocked: boolean;
  done: boolean;
}

interface PhaseRailProps {
  projectId: string;
  phases: Phase[];
  activePath: string;
}

export const PhaseRail = ({ projectId, phases, activePath }: PhaseRailProps) => {
  return (
    <nav style={{ display: "grid", gap: "0.42rem" }}>
      <h2 style={{ margin: "0 0 0.55rem", fontFamily: "'VT323', monospace", fontSize: "1.65rem", letterSpacing: "0.04em", color: "var(--forge-hot)" }}>
        Phases
      </h2>
      {phases.map((phase) => {
        const isActive = activePath === phase.path;
        const state = isActive
          ? "Current"
          : phase.done
            ? "Done"
            : !phase.unlocked
              ? "Locked"
              : "Ready";

        return (
          <a
            key={phase.id}
            href={phase.unlocked ? phase.path : undefined}
            data-active={isActive}
            aria-current={isActive ? "step" : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr auto",
              alignItems: "center",
              gap: "0.5rem",
              border: `1px solid ${isActive ? "#f2a96a" : "var(--forge-line)"}`,
              borderRadius: "9px",
              background: "#0f1628",
              padding: "0.58rem 0.6rem",
              textDecoration: "none",
              color: "inherit",
              opacity: phase.unlocked ? 1 : 0.55,
              cursor: phase.unlocked ? "pointer" : "not-allowed",
              boxShadow: isActive ? "inset 0 0 0 1px rgb(242 169 106 / 0.35)" : "none",
            }}
          >
            <span style={{
              display: "grid",
              placeItems: "center",
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              border: "1px solid #6f7da2",
              fontWeight: 700,
              fontSize: "0.82rem",
            }}>
              {phase.id}
            </span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{phase.label}</span>
            <span style={{ fontSize: "0.78rem", color: "var(--forge-muted)" }}>{state}</span>
          </a>
        );
      })}
    </nav>
  );
};
