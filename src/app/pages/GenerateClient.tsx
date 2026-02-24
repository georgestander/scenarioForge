"use client";

import { useMemo, useState } from "react";
import type { Project, ScenarioPack, SourceManifest } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type { ScenarioActionGeneratePayload } from "@/app/shared/types";

export const GenerateClient = ({
  projectId,
  project,
  initialManifest,
  initialPacks,
}: {
  projectId: string;
  project: Project;
  initialManifest: SourceManifest;
  initialPacks: ScenarioPack[];
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const { streamAction, codexStreamEvents, clearStreamEvents } = useStreamAction();
  const [scenarioPacks, setScenarioPacks] = useState<ScenarioPack[]>(initialPacks);
  const [selectedPackId, setSelectedPackId] = useState(initialPacks[0]?.id ?? "");
  const [updateInstruction, setUpdateInstruction] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedPack =
    scenarioPacks.find((p) => p.id === selectedPackId) ?? scenarioPacks[0] ?? null;

  const generateEvents = useMemo(
    () => codexStreamEvents.filter((e) => e.action === "generate"),
    [codexStreamEvents],
  );

  const handleGenerate = async (mode: "initial" | "update") => {
    if (isGenerating) return;
    setIsGenerating(true);
    clearStreamEvents();
    setStatusMessage(
      mode === "update"
        ? "Updating scenario pack via Codex app-server..."
        : "Generating scenario pack via Codex app-server...",
    );
    try {
      const payload = await streamAction<ScenarioActionGeneratePayload>(
        "generate",
        `/api/projects/${projectId}/actions/generate/stream`,
        {
          sourceManifestId: initialManifest.id,
          mode,
          userInstruction: updateInstruction.trim(),
          scenarioPackId: selectedPack?.id ?? "",
        },
        "Failed to generate scenarios.",
      );
      setScenarioPacks((current) => [payload.pack, ...current]);
      setSelectedPackId(payload.pack.id);
      setStatusMessage(
        `${payload.mode === "update" ? "Updated" : "Generated"} ${payload.pack.scenarios.length} scenarios.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadArtifact = (format: "markdown" | "json") => {
    if (!selectedPack) {
      setStatusMessage("Select a scenario pack first.");
      return;
    }
    window.open(`/api/scenario-packs/${selectedPack.id}/artifacts/${format}`, "_blank", "noopener");
  };

  return (
    <section style={{ display: "grid", gap: "0.55rem" }}>
      <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        Generate Scenarios
      </h2>
      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Project: <strong>{project.name}</strong> — Build or update grouped scenarios from confirmed sources.
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

      <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button type="button" onClick={() => void handleGenerate("initial")} disabled={isGenerating}>
          {isGenerating ? "Generating Scenarios..." : "Generate Scenarios"}
        </button>
        <button
          type="button"
          onClick={() => void handleGenerate("update")}
          disabled={isGenerating}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          {isGenerating ? "Updating..." : "Update Scenarios"}
        </button>
      </div>

      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Update instruction (optional)
        <input
          value={updateInstruction}
          onChange={(e) => setUpdateInstruction(e.target.value)}
          placeholder="Example: add checkout edge cases and stale-doc conflict paths."
        />
      </label>

      {generateEvents.length > 0 ? (
        <>
          <h3 style={{ margin: "0.55rem 0 0.3rem", fontFamily: "'VT323', monospace", fontSize: "1.28rem", color: "var(--forge-hot)" }}>
            Codex Stream
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {generateEvents.map((event) => (
              <li key={event.id} style={{ lineHeight: 1.3 }}>
                {event.timestamp} | {event.phase} | {event.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Active scenario pack
        <select
          value={selectedPack?.id ?? ""}
          onChange={(e) => setSelectedPackId(e.target.value)}
        >
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
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            Generated with <strong>{selectedPack.model}</strong> and manifest{" "}
            <strong>{selectedPack.manifestId}</strong>.
          </p>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            Repo <strong>{selectedPack.repositoryFullName}</strong> on{" "}
            <strong>{selectedPack.branch}</strong> @{" "}
            <strong>{selectedPack.headCommitSha.slice(0, 12)}</strong>.
          </p>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
            Codex turn <strong>{selectedPack.generationAudit.threadId}</strong> /{" "}
            <strong>{selectedPack.generationAudit.turnId}</strong> ({selectedPack.generationAudit.turnStatus}).
          </p>

          <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <button
              type="button"
              onClick={() => handleDownloadArtifact("markdown")}
              style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
            >
              Download scenarios.md
            </button>
            <button
              type="button"
              onClick={() => handleDownloadArtifact("json")}
              style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
            >
              Download scenarios.json
            </button>
          </div>

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
        </>
      ) : (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No scenario pack generated yet.
        </p>
      )}

      <a
        href={`/projects/${projectId}/review`}
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
        Review →
      </a>
    </section>
  );
};
