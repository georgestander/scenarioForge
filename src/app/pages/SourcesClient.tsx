"use client";

import { useMemo, useState } from "react";
import type { Project, SourceManifest, SourceRecord } from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type { CollectionPayload, ManifestCreatePayload } from "@/app/shared/types";

export const SourcesClient = ({
  projectId,
  project,
  initialSources,
  initialManifests,
}: {
  projectId: string;
  project: Project;
  initialSources: SourceRecord[];
  initialManifests: SourceManifest[];
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const [sources, setSources] = useState<SourceRecord[]>(initialSources);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(
    initialSources.filter((s) => s.selected).map((s) => s.id),
  );
  const [manifests, setManifests] = useState<SourceManifest[]>(initialManifests);
  const [confirmationNote, setConfirmationNote] = useState("Confirmed against current product direction.");
  const [includeStaleConfirmed, setIncludeStaleConfirmed] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const latestManifest = manifests[0] ?? null;

  const riskySelectedCount = useMemo(
    () =>
      sources.filter(
        (s) =>
          selectedSourceIds.includes(s.id) &&
          (s.status === "stale" || s.isConflicting),
      ).length,
    [sources, selectedSourceIds],
  );

  const handleScanSources = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setStatusMessage("Scanning repository for planning sources...");
    try {
      const response = await fetch(`/api/projects/${projectId}/sources/scan`, { method: "POST" });
      if (!response.ok) {
        setStatusMessage(await readError(response, "Failed to scan sources."));
        return;
      }
      const payload = (await response.json()) as CollectionPayload<SourceRecord>;
      const scanned = payload.data ?? [];
      setSources(scanned);
      setSelectedSourceIds(scanned.filter((s) => s.selected).map((s) => s.id));
      setStatusMessage(`Scanned ${scanned.length} sources. Review and select below.`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    );
  };

  const handleCreateScenarios = async () => {
    if (selectedSourceIds.length === 0) {
      setStatusMessage("Select at least one source.");
      return;
    }

    if (riskySelectedCount > 0 && !includeStaleConfirmed) {
      setStatusMessage("Selected sources include stale or conflicting entries. Check the confirmation toggle.");
      return;
    }

    const response = await fetch(`/api/projects/${projectId}/source-manifests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceIds: selectedSourceIds,
        userConfirmed: true,
        confirmationNote,
      }),
    });

    if (!response.ok) {
      setStatusMessage(await readError(response, "Failed to create source manifest."));
      return;
    }

    const payload = (await response.json()) as ManifestCreatePayload;
    setManifests((current) => [payload.manifest, ...current]);
    setSources((current) =>
      current.map((s) => ({ ...s, selected: selectedSourceIds.includes(s.id) })),
    );
    setStatusMessage(`Source manifest confirmed. Proceed to generation.`);
  };

  return (
    <section style={{ display: "grid", gap: "1.5rem", maxWidth: "480px", margin: "0 auto", textAlign: "center" }}>
      <h2 style={{
        margin: 0,
        fontFamily: "'VT323', monospace",
        fontSize: "1.65rem",
        color: "var(--forge-hot)",
      }}>
        Sources found
      </h2>

      {statusMessage ? (
        <p style={{
          margin: 0,
          fontSize: "0.85rem",
          color: "var(--forge-muted)",
          padding: "0.45rem 0.6rem",
          borderRadius: "6px",
          background: "rgba(42, 52, 84, 0.4)",
        }}>
          {statusMessage}
        </p>
      ) : null}

      {sources.length === 0 ? (
        <>
          <p style={{ color: "var(--forge-muted)", fontSize: "0.88rem", margin: 0 }}>
            No sources yet. Scan <strong style={{ color: "var(--forge-ink)" }}>{project.name}</strong> to discover planning docs.
          </p>
          <button
            type="button"
            onClick={() => void handleScanSources()}
            disabled={isScanning}
            style={{ justifySelf: "center" }}
          >
            {isScanning ? "Scanning..." : "Scan sources"}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gap: "0.5rem", textAlign: "left" }}>
            {sources.map((source) => (
              <label
                key={source.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.55rem",
                  padding: "0.5rem 0.6rem",
                  borderRadius: "7px",
                  border: "1px solid var(--forge-line)",
                  background: "rgba(20, 26, 46, 0.6)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedSourceIds.includes(source.id)}
                  onChange={() => handleToggleSource(source.id)}
                  style={{ width: "auto", marginTop: "0.2rem", flexShrink: 0 }}
                />
                <span style={{ display: "grid", gap: "0.1rem", fontSize: "0.85rem" }}>
                  <strong style={{ color: "var(--forge-ink)" }}>{source.title}</strong>
                  <span style={{ color: "var(--forge-muted)", fontSize: "0.78rem" }}>{source.path}</span>
                </span>
              </label>
            ))}
          </div>

          {riskySelectedCount > 0 ? (
            <label style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.45rem",
              fontSize: "0.82rem",
              color: "var(--forge-muted)",
            }}>
              <input
                type="checkbox"
                checked={includeStaleConfirmed}
                onChange={(e) => setIncludeStaleConfirmed(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              Include stale/conflicting sources
            </label>
          ) : null}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => void handleScanSources()}
              disabled={isScanning}
              style={{ fontSize: "0.85rem" }}
            >
              {isScanning ? "Scanning..." : "Rescan"}
            </button>
            <button
              type="button"
              onClick={() => void handleCreateScenarios()}
              disabled={selectedSourceIds.length === 0}
            >
              create scenarios
            </button>
          </div>
        </>
      )}

      {latestManifest ? (
        <a
          href={`/projects/${projectId}/generate`}
          style={{
            display: "inline-block",
            justifySelf: "center",
            padding: "0.52rem 1.2rem",
            borderRadius: "7px",
            border: "1px solid var(--forge-line)",
            color: "var(--forge-ink)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.89rem",
          }}
        >
          Continue to generation
        </a>
      ) : null}
    </section>
  );
};
