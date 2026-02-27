"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ScenarioPack, SourceManifest } from "@/domain/models";
import { useSession } from "@/app/shared/SessionContext";
import { useStreamAction } from "@/app/shared/useStreamAction";
import type {
  CodexStreamEventLog,
  ScenarioActionGeneratePayload,
} from "@/app/shared/types";

export const GenerateClient = ({
  projectId,
  project: _project,
  initialManifest,
  initialPacks,
}: {
  projectId: string;
  project: Project;
  initialManifest: SourceManifest;
  initialPacks: ScenarioPack[];
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const { streamAction, clearStreamEvents } = useStreamAction();
  const [scenarioPacks, setScenarioPacks] = useState<ScenarioPack[]>(initialPacks);
  const [selectedPackId, setSelectedPackId] = useState(initialPacks[0]?.id ?? "");
  const [updateInstruction, setUpdateInstruction] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [generatedTotal, setGeneratedTotal] = useState(0);
  const [latestGeneratedLabel, setLatestGeneratedLabel] = useState("");
  const autoStartedInitialGenerationRef = useRef(false);

  const selectedPack =
    scenarioPacks.find((pack) => pack.id === selectedPackId) ?? scenarioPacks[0] ?? null;

  const parseGenerationProgressEvent = (event: CodexStreamEventLog) => {
    if (event.action !== "generate" || event.event !== "status") {
      return;
    }
    if (event.phase !== "generate.scenario") {
      return;
    }

    const text = event.message.trim();
    const match = text.match(/^Created\s+(\d+)\s*\/\s*(\d+):\s*(.+)$/i);
    if (!match) {
      return;
    }

    const current = Number.parseInt(match[1] ?? "", 10);
    const total = Number.parseInt(match[2] ?? "", 10);
    const label = (match[3] ?? "").trim();
    if (Number.isFinite(current) && current > 0) {
      setGeneratedCount(current);
    }
    if (Number.isFinite(total) && total > 0) {
      setGeneratedTotal(total);
    }
    if (label) {
      setLatestGeneratedLabel(label);
    }
  };

  const handleGenerate = async (mode: "initial" | "update") => {
    if (isGenerating) {
      return;
    }

    setIsGenerating(true);
    setGeneratedCount(0);
    setGeneratedTotal(0);
    setLatestGeneratedLabel("");
    clearStreamEvents();
    setStatusMessage(
      mode === "update"
        ? "Updating scenarios with your latest instruction..."
        : "Generating scenarios from trusted sources...",
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
        parseGenerationProgressEvent,
      );

      setScenarioPacks((current) => [payload.pack, ...current]);
      setSelectedPackId(payload.pack.id);
      const count = payload.pack.scenarios.length;
      setGeneratedCount(count);
      setGeneratedTotal(count);
      setStatusMessage(
        `${payload.mode === "update" ? "Updated" : "Generated"} ${count} scenario${
          count === 1 ? "" : "s"
        }. Opening review...`,
      );
      window.location.href = `/projects/${projectId}/review?packId=${encodeURIComponent(payload.pack.id)}`;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const canUpdate = Boolean(selectedPack);

  useEffect(() => {
    if (autoStartedInitialGenerationRef.current) {
      return;
    }
    if (isGenerating || canUpdate) {
      return;
    }

    autoStartedInitialGenerationRef.current = true;
    void handleGenerate("initial");
  }, [canUpdate, isGenerating]);

  return (
    <section
      style={{
        maxWidth: "560px",
        margin: "0 auto",
        padding: "1rem 0.75rem",
        display: "grid",
        gap: "0.9rem",
      }}
    >
      <h2
        style={{
          margin: 0,
          textAlign: "center",
          fontFamily: "'VT323', monospace",
          fontSize: "1.65rem",
          color: "var(--forge-hot)",
        }}
      >
        {isGenerating ? "Generating Scenarios" : "Generate Scenarios"}
      </h2>

      {statusMessage ? (
        <p
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: "0.84rem",
            color: "var(--forge-muted)",
          }}
        >
          {statusMessage}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: "0.45rem",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => void handleGenerate(canUpdate ? "update" : "initial")}
          disabled={isGenerating}
        >
          {isGenerating
            ? "Generating..."
            : canUpdate
              ? "Update Scenarios"
              : "Generate Scenarios"}
        </button>
        {canUpdate ? (
          <a
            href={`/projects/${projectId}/review?packId=${encodeURIComponent(selectedPack.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.52rem 0.8rem",
              borderRadius: "7px",
              border: "1px solid var(--forge-line)",
              color: "var(--forge-ink)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.88rem",
            }}
          >
            Open Latest Review
          </a>
        ) : null}
      </div>

      {canUpdate ? (
        <label
          style={{
            display: "grid",
            gap: "0.24rem",
            fontSize: "0.84rem",
            color: "var(--forge-muted)",
            textAlign: "left",
          }}
        >
          Update instruction (optional)
          <input
            value={updateInstruction}
            onChange={(event) => setUpdateInstruction(event.target.value)}
            placeholder="e.g. add checkout edge cases"
            disabled={isGenerating}
          />
        </label>
      ) : null}

      {isGenerating ? (
        <div
          style={{
            border: "1px solid var(--forge-line)",
            borderRadius: "8px",
            padding: "0.55rem 0.65rem",
            background: "rgba(18, 24, 43, 0.6)",
            display: "grid",
            gap: "0.32rem",
          }}
        >
          <strong style={{ color: "var(--forge-ink)", fontSize: "0.84rem" }}>
            Generation progress
          </strong>
          <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.76rem" }}>
            Created {generatedCount}
            {generatedTotal > 0 ? ` / ${generatedTotal}` : ""} scenario
            {generatedCount === 1 ? "" : "s"}.
          </p>
          <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.74rem" }}>
            {latestGeneratedLabel
              ? `Latest: ${latestGeneratedLabel}`
              : "Codex is generating scenario coverage..."}
          </p>
        </div>
      ) : null}
    </section>
  );
};
