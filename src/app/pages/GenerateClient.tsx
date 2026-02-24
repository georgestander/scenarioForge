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
  const scenarioStatuses = useMemo(() => {
    const byScenarioId = new Map<string, { status: string; message: string }>();
    for (const event of generateEvents) {
      if (event.scenarioId) {
        byScenarioId.set(event.scenarioId, {
          status: event.status ?? "running",
          message: event.message,
        });
      }
    }
    return byScenarioId;
  }, [generateEvents]);

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

  const hasReviewablePack = selectedPack !== null;

  return (
    <section style={{ maxWidth: "520px", margin: "0 auto", padding: "2rem 1rem", display: "grid", gap: "1rem" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Heading */}
      <h2 style={{ margin: 0, textAlign: "center", fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        {isGenerating ? "Generating Scenarios" : hasReviewablePack ? "Scenarios Ready" : "Generate Scenarios"}
      </h2>

      {statusMessage && (
        <p style={{ margin: 0, textAlign: "center", fontSize: "0.84rem", color: "var(--forge-muted)" }}>
          {statusMessage}
        </p>
      )}

      {/* Buttons — always at top */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
        {!isGenerating && (
          <>
            <button type="button" onClick={() => void handleGenerate("initial")} disabled={isGenerating}>
              Generate Scenarios
            </button>
            {scenarioPacks.length > 0 && (
              <button
                type="button"
                onClick={() => void handleGenerate("update")}
                disabled={isGenerating}
                style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
              >
                Update Scenarios
              </button>
            )}
            {hasReviewablePack && (
              <a
                href={`/projects/${projectId}/review`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
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
            )}
          </>
        )}
      </div>

      {/* Update instruction — shown when packs exist and not generating */}
      {!isGenerating && scenarioPacks.length > 0 && (
        <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.84rem", color: "var(--forge-muted)", textAlign: "left" }}>
          Update instruction (optional)
          <input
            value={updateInstruction}
            onChange={(e) => setUpdateInstruction(e.target.value)}
            placeholder="e.g. add checkout edge cases"
          />
        </label>
      )}

      {/* Spinner while generating */}
      {isGenerating && (
        <div style={{ textAlign: "center", fontSize: "2rem", color: "var(--forge-fire)", animation: "spin 1.2s linear infinite" }}>*</div>
      )}

      {/* Streaming events — scrollable container */}
      {generateEvents.length > 0 && (
        <ul style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: "0.3rem",
          textAlign: "left",
          fontSize: "0.82rem",
          color: "var(--forge-muted)",
          maxHeight: "calc(100vh - 320px)",
          minHeight: "80px",
          overflowY: "auto",
        }}>
          {generateEvents.map((event) => (
            <li key={event.id} style={{ lineHeight: 1.4 }}>
              <span style={{ color: "var(--forge-fire)", marginRight: "0.4rem" }}>*</span>
              {event.message}
            </li>
          ))}
        </ul>
      )}

      {selectedPack && (
        <>
          <h3 style={{ margin: 0, textAlign: "center", fontFamily: "'VT323', monospace", fontSize: "1.35rem", color: "var(--forge-hot)" }}>
            Scenario Checklist
          </h3>
          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: "0.3rem",
            maxHeight: "220px",
            overflowY: "auto",
          }}>
            {selectedPack.scenarios.map((scenario) => {
              const event = scenarioStatuses.get(scenario.id);
              const status = event?.status ?? "passed";
              const color =
                status === "passed"
                  ? "var(--forge-ok)"
                  : status === "failed"
                    ? "#e25555"
                    : status === "blocked"
                      ? "var(--forge-muted)"
                      : "var(--forge-fire)";

              return (
                <li
                  key={scenario.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: "0.5rem",
                    alignItems: "center",
                    border: "1px solid var(--forge-line)",
                    borderRadius: "7px",
                    padding: "0.42rem 0.55rem",
                    background: "rgba(20, 26, 46, 0.6)",
                  }}
                >
                  <span style={{ color }}>
                    {status === "passed" ? "\u2713" : status === "failed" ? "\u2717" : status === "blocked" ? "\u2014" : "\u21BB"}
                  </span>
                  <span style={{ fontSize: "0.82rem", color: "var(--forge-ink)" }}>
                    {scenario.title}
                  </span>
                  <span style={{ fontSize: "0.72rem", color }}>
                    {status}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
};
