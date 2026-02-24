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
        const isDone = phase.done;
        const state = isActive
          ? isDone
            ? "Done"
            : "Running"
          : isDone
            ? "Done"
            : !phase.unlocked
              ? "Locked"
              : "Ready";
        const ringColor = isActive ? "var(--forge-fire)" : isDone ? "var(--forge-ok)" : "#6f7da2";
        const chipColor = isActive ? "var(--forge-fire)" : "var(--forge-muted)";
        const icon = isDone ? "\u2713" : String(phase.id);

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
              border: `1px solid ${isActive ? "var(--forge-fire)" : "var(--forge-line)"}`,
              borderRadius: "9px",
              background: isActive
                ? "linear-gradient(180deg, rgba(173, 90, 51, 0.25) 0%, rgba(23, 36, 62, 0.92) 100%)"
                : "#0f1628",
              padding: "0.58rem 0.6rem",
              textDecoration: "none",
              color: "inherit",
              opacity: phase.unlocked ? 1 : 0.55,
              cursor: phase.unlocked ? "pointer" : "not-allowed",
              boxShadow: isActive
                ? "0 0 0 1px rgb(173 90 51 / 0.45), inset 0 0 0 1px rgb(242 169 106 / 0.45), 0 0 16px rgb(173 90 51 / 0.25)"
                : "none",
            }}
          >
            <span style={{
              display: "grid",
              placeItems: "center",
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              border: `1px solid ${ringColor}`,
              fontWeight: 700,
              fontSize: "0.82rem",
              color: ringColor,
              background: isDone ? "rgba(93, 187, 125, 0.12)" : "transparent",
            }}>
              {icon}
            </span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem", color: isActive ? "var(--forge-hot)" : "inherit" }}>{phase.label}</span>
            <span style={{ fontSize: "0.78rem", color: chipColor }}>{state}</span>
          </a>
        );
      })}
    </nav>
  );
};
