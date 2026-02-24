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

  const hasGenerated = !isGenerating && generateEvents.length > 0;

  return (
    <section style={{ maxWidth: "520px", margin: "0 auto", padding: "2rem 1rem", display: "grid", gap: "1.2rem" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* IDLE: show generate button */}
      {!isGenerating && generateEvents.length === 0 && (
        <div style={{ textAlign: "center", display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
            Generate Scenarios
          </h2>

          {scenarioPacks.length > 0 && (
            <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)", textAlign: "left" }}>
              Update instruction (optional)
              <input
                value={updateInstruction}
                onChange={(e) => setUpdateInstruction(e.target.value)}
                placeholder="e.g. add checkout edge cases"
              />
            </label>
          )}

          <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: scenarioPacks.length > 0 ? "1fr 1fr" : "1fr" }}>
            <button type="button" onClick={() => void handleGenerate("initial")}>
              Generate Scenarios
            </button>
            {scenarioPacks.length > 0 && (
              <button
                type="button"
                onClick={() => void handleGenerate("update")}
                style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
              >
                Update Scenarios
              </button>
            )}
          </div>
        </div>
      )}

      {/* GENERATING: spinner + streaming events */}
      {isGenerating && (
        <div style={{ textAlign: "center", display: "grid", gap: "1rem" }}>
          <div style={{ fontSize: "2rem", color: "var(--forge-fire)", animation: "spin 1.2s linear infinite" }}>
            *
          </div>
          <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
            Generating Scenarios
          </h2>
          {generateEvents.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.3rem", textAlign: "left", fontSize: "0.82rem", color: "var(--forge-muted)" }}>
              {generateEvents.map((event) => (
                <li key={event.id} style={{ lineHeight: 1.4 }}>
                  <span style={{ color: "var(--forge-fire)", marginRight: "0.4rem" }}>*</span>
                  {event.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* DONE: events + Review link */}
      {hasGenerated && (
        <div style={{ textAlign: "center", display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
            Scenarios Generated
          </h2>
          <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--forge-muted)" }}>
            {statusMessage}
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.3rem", textAlign: "left", fontSize: "0.82rem", color: "var(--forge-muted)" }}>
            {generateEvents.map((event) => (
              <li key={event.id} style={{ lineHeight: 1.4 }}>
                <span style={{ color: "var(--forge-fire)", marginRight: "0.4rem" }}>*</span>
                {event.message}
              </li>
            ))}
          </ul>
          <a
            href={`/projects/${projectId}/review`}
            style={{
              display: "inline-block",
              margin: "0.5rem auto 0",
              padding: "0.55rem 1.5rem",
              borderRadius: "7px",
              border: "1px solid var(--forge-line)",
              background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
              color: "var(--forge-ink)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
            }}
          >
            Review
          </a>
        </div>
      )}
    </section>
  );
};
