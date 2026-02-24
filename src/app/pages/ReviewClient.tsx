"use client";

import { useMemo, useState } from "react";
import type { Project, ScenarioPack } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type { ScenarioActionGeneratePayload } from "@/app/shared/types";

export const ReviewClient = ({
  projectId,
  project,
  initialPacks,
}: {
  projectId: string;
  project: Project;
  initialPacks: ScenarioPack[];
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const { streamAction, codexStreamEvents, clearStreamEvents } = useStreamAction();
  const [scenarioPacks, setScenarioPacks] = useState<ScenarioPack[]>(initialPacks);
  const [selectedPackId, setSelectedPackId] = useState(initialPacks[0]?.id ?? "");
  const [updateInstruction, setUpdateInstruction] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const selectedPack =
    scenarioPacks.find((p) => p.id === selectedPackId) ?? scenarioPacks[0] ?? null;

  const updateEvents = useMemo(
    () => codexStreamEvents.filter((e) => e.action === "generate"),
    [codexStreamEvents],
  );

  const handleUpdateScenarios = async () => {
    if (isUpdating || !selectedPack) return;
    setIsUpdating(true);
    clearStreamEvents();
    setStatusMessage("Updating scenario pack via Codex...");
    try {
      const payload = await streamAction<ScenarioActionGeneratePayload>(
        "generate",
        `/api/projects/${projectId}/actions/generate/stream`,
        {
          sourceManifestId: selectedPack.manifestId,
          mode: "update",
          userInstruction: updateInstruction.trim(),
          scenarioPackId: selectedPack.id,
        },
        "Failed to update scenarios.",
      );
      setScenarioPacks((current) => [payload.pack, ...current]);
      setSelectedPackId(payload.pack.id);
      setStatusMessage(`Updated to ${payload.pack.scenarios.length} scenarios.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDownloadArtifact = (format: "markdown" | "json") => {
    if (!selectedPack) return;
    window.open(`/api/scenario-packs/${selectedPack.id}/artifacts/${format}`, "_blank", "noopener");
  };

  return (
    <section style={{ display: "grid", gap: "0.55rem" }}>
      <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        Review Scenarios
      </h2>
      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Project: <strong>{project.name}</strong> — Inspect scenarios, update with instructions, and approve for execution.
      </p>

      <p style={{
        margin: 0,
        border: "1px solid #6a452f",
        borderRadius: "10px",
        background: "linear-gradient(180deg, rgb(163 87 46 / 0.22) 0%, rgb(97 53 29 / 0.18) 100%)",
        padding: "0.6rem 0.75rem",
        color: "var(--forge-ink)",
        fontSize: "0.9rem",
      }}>
        {statusMessage}
      </p>

      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Pack selector
        <select value={selectedPack?.id ?? ""} onChange={(e) => setSelectedPackId(e.target.value)}>
          <option value="">Select pack</option>
          {scenarioPacks.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.id} ({pack.scenarios.length} scenarios)
            </option>
          ))}
        </select>
      </label>

      {selectedPack ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Feature Groups
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {Object.entries(selectedPack.groupedByFeature).map(([feature, ids]) => (
              <li key={feature} style={{ lineHeight: 1.3 }}>
                <strong>{feature}</strong>: {ids.length} scenarios
              </li>
            ))}
          </ul>

          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Outcome Groups
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {Object.entries(selectedPack.groupedByOutcome).map(([outcome, ids]) => (
              <li key={outcome} style={{ lineHeight: 1.3 }}>
                <strong>{outcome}</strong>: {ids.length} scenarios
              </li>
            ))}
          </ul>

          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Scenario Details
          </h3>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {selectedPack.scenarios.map((scenario) => (
              <div
                key={scenario.id}
                style={{
                  border: "1px solid var(--forge-line)",
                  borderRadius: "9px",
                  padding: "0.6rem",
                  background: "#0f1628",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                  <strong style={{ fontSize: "0.9rem" }}>{scenario.title}</strong>
                  <span style={{
                    fontSize: "0.72rem",
                    padding: "0.15rem 0.4rem",
                    borderRadius: "4px",
                    background: scenario.priority === "critical" ? "#7f2828" : scenario.priority === "high" ? "#7f4828" : "#3f557f",
                    color: "var(--forge-ink)",
                  }}>
                    {scenario.priority}
                  </span>
                </div>
                <p style={{ margin: "0 0 0.25rem", fontSize: "0.82rem", color: "var(--forge-muted)" }}>
                  <strong>Persona:</strong> {scenario.persona} | <strong>Feature:</strong> {scenario.feature} | <strong>Outcome:</strong> {scenario.outcome}
                </p>
                {scenario.preconditions.length > 0 ? (
                  <p style={{ margin: "0 0 0.2rem", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                    <strong>Preconditions:</strong> {scenario.preconditions.join("; ")}
                  </p>
                ) : null}
                <p style={{ margin: "0 0 0.2rem", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                  <strong>Steps:</strong> {scenario.steps.join(" → ")}
                </p>
                <p style={{ margin: "0 0 0.2rem", fontSize: "0.78rem", color: "var(--forge-muted)" }}>
                  <strong>Pass Criteria:</strong> {scenario.passCriteria}
                </p>
                {scenario.edgeVariants.length > 0 ? (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#f2a96a" }}>
                    <strong>Edge Variants:</strong> {scenario.edgeVariants.join("; ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No scenario pack selected.
        </p>
      )}

      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Update instruction
        <input
          value={updateInstruction}
          onChange={(e) => setUpdateInstruction(e.target.value)}
          placeholder="Example: add checkout edge cases and stale-doc conflict paths."
        />
      </label>

      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button type="button" onClick={() => void handleUpdateScenarios()} disabled={isUpdating || !selectedPack}>
          {isUpdating ? "Updating..." : "Update Scenarios"}
        </button>
        <button
          type="button"
          onClick={() => handleDownloadArtifact("markdown")}
          disabled={!selectedPack}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          Download scenarios.md
        </button>
      </div>

      {updateEvents.length > 0 ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Codex Stream
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {updateEvents.map((event) => (
              <li key={event.id} style={{ lineHeight: 1.3 }}>
                {event.timestamp} | {event.phase} | {event.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <a
        href={`/projects/${projectId}/execute`}
        style={{
          display: "inline-block",
          padding: "0.52rem 0.62rem",
          borderRadius: "7px",
          border: "1px solid #7f482b",
          background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
          color: "var(--forge-ink)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.89rem",
          textAlign: "center",
          opacity: selectedPack ? 1 : 0.55,
          pointerEvents: selectedPack ? "auto" : "none",
        }}
      >
        Run →
      </a>
    </section>
  );
};
