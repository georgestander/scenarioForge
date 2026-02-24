"use client";

import { useState } from "react";
import type { Project, ScenarioPack } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type { ScenarioActionGeneratePayload } from "@/app/shared/types";

export const ReviewClient = ({
  projectId,
  project,
  initialPacks,
  initialSelectedPackId,
}: {
  projectId: string;
  project: Project;
  initialPacks: ScenarioPack[];
  initialSelectedPackId?: string;
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const { streamAction, clearStreamEvents } = useStreamAction();
  const [scenarioPacks, setScenarioPacks] = useState<ScenarioPack[]>(initialPacks);
  const [selectedPackId, setSelectedPackId] = useState(
    initialSelectedPackId && initialPacks.some((pack) => pack.id === initialSelectedPackId)
      ? initialSelectedPackId
      : initialPacks[0]?.id ?? "",
  );
  const [updateInstruction, setUpdateInstruction] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const selectedPack =
    scenarioPacks.find((p) => p.id === selectedPackId) ?? scenarioPacks[0] ?? null;
  const coverage = selectedPack?.coverage ?? {
    personas: [],
    journeys: [],
    edgeBuckets: [],
    features: [],
    outcomes: [],
    assumptions: [],
    knownUnknowns: [],
    uncoveredGaps: [],
  };

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
    <section style={{ maxWidth: "600px", margin: "0 auto", display: "grid", gap: "1rem" }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{
          margin: "0.25rem 0 0",
          fontFamily: "'VT323', monospace",
          fontSize: "1.65rem",
          color: "var(--forge-hot)",
        }}>
          Scenario List
        </h2>
        <p style={{ margin: "0.25rem 0 0", color: "var(--forge-muted)", fontSize: "0.84rem" }}>
          {selectedPack ? `${selectedPack.scenarios.length} scenarios` : "No pack selected"}
        </p>
      </div>

      {statusMessage ? (
        <p style={{
          margin: 0,
          padding: "0.5rem 0.75rem",
          borderRadius: "8px",
          border: "1px solid var(--forge-line)",
          fontSize: "0.84rem",
          color: "var(--forge-muted)",
          textAlign: "center",
        }}>
          {statusMessage}
        </p>
      ) : null}

      {/* Buttons — at top */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => handleDownloadArtifact("markdown")}
          disabled={!selectedPack}
          style={{ borderColor: "var(--forge-line)", background: "transparent" }}
        >
          Download Markdown
        </button>
        {selectedPack ? (
          <a
            href={`/projects/${projectId}/execute?packId=${encodeURIComponent(selectedPack.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.52rem 0.75rem",
              borderRadius: "7px",
              border: "1px solid #7f482b",
              background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
              color: "var(--forge-ink)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.89rem",
            }}
          >
            Run Execute Loop
          </a>
        ) : null}
      </div>

      {selectedPack ? (
        <div
          style={{
            border: "1px solid var(--forge-line)",
            borderRadius: "8px",
            padding: "0.55rem 0.65rem",
            background: "rgba(18, 24, 43, 0.6)",
            display: "grid",
            gap: "0.35rem",
          }}
        >
          <strong style={{ color: "var(--forge-ink)", fontSize: "0.84rem" }}>
            Scenario quality notes
          </strong>
          <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.76rem" }}>
            personas {coverage.personas.length} | journeys{" "}
            {coverage.journeys.length} | edge buckets{" "}
            {coverage.edgeBuckets.length} | assumptions{" "}
            {coverage.assumptions.length}
          </p>
          {coverage.knownUnknowns.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: "1rem",
                color: "var(--forge-muted)",
                fontSize: "0.74rem",
                display: "grid",
                gap: "0.15rem",
              }}
            >
              {coverage.knownUnknowns.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: "var(--forge-ok)", fontSize: "0.75rem" }}>
              Scenarios are ready for execution.
            </p>
          )}
        </div>
      ) : null}

      {/* Update instruction — at top, below buttons */}
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "end" }}>
        <input
          value={updateInstruction}
          onChange={(e) => setUpdateInstruction(e.target.value)}
          placeholder="e.g. add checkout edge cases"
          style={{ flex: 1, boxSizing: "border-box" }}
        />
        <button
          type="button"
          onClick={() => void handleUpdateScenarios()}
          disabled={isUpdating || !selectedPack}
          style={{
            borderColor: "#3f557f",
            background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
            whiteSpace: "nowrap",
          }}
        >
          {isUpdating ? "Updating..." : "Update Scenarios"}
        </button>
      </div>

      {/* Scenario accordions — scrollable */}
      {selectedPack ? (
        <div style={{
          maxHeight: "calc(100vh - 340px)",
          minHeight: "120px",
          overflowY: "auto",
          display: "grid",
          gap: "0.35rem",
        }}>
          {selectedPack.scenarios.map((scenario) => (
            <details
              key={scenario.id}
              style={{
                border: "1px solid var(--forge-line)",
                borderRadius: "7px",
                textAlign: "left",
              }}
            >
              <summary style={{
                padding: "0.5rem 0.65rem",
                fontSize: "0.84rem",
                fontWeight: 600,
                color: "var(--forge-ink)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}>
                <span style={{ color: "var(--forge-muted)", fontSize: "0.72rem", flexShrink: 0 }}>
                  {scenario.id}
                </span>
                <span>{scenario.title}</span>
              </summary>
              <div style={{
                padding: "0 0.65rem 0.55rem",
                fontSize: "0.78rem",
                color: "var(--forge-muted)",
                lineHeight: 1.5,
                display: "grid",
                gap: "0.3rem",
              }}>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "var(--forge-ink)" }}>Pass criteria:</strong> {scenario.passCriteria}
                </p>
                {scenario.persona && (
                  <p style={{ margin: 0 }}>
                    <strong style={{ color: "var(--forge-ink)" }}>Persona:</strong> {scenario.persona}
                  </p>
                )}
                {scenario.steps.length > 0 && (
                  <div>
                    <strong style={{ color: "var(--forge-ink)" }}>Steps:</strong>
                    <ol style={{ margin: "0.15rem 0 0", paddingLeft: "1.2rem" }}>
                      {scenario.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {scenario.edgeVariants.length > 0 && (
                  <p style={{ margin: 0 }}>
                    <strong style={{ color: "var(--forge-ink)" }}>Edge variants:</strong> {scenario.edgeVariants.join("; ")}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p style={{ textAlign: "center", color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No scenario pack selected.
        </p>
      )}
    </section>
  );
};
