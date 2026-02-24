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
      setStatusMessage(`Scanned ${scanned.length} sources. Review trust statuses.`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    );
  };

  const handleConfirmManifest = async () => {
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
    setStatusMessage(`Source manifest ${payload.manifest.id} confirmed. Proceed to generation.`);
  };

  return (
    <section style={{ display: "grid", gap: "0.55rem" }}>
      <h2 style={{ margin: 0, fontFamily: "'VT323', monospace", fontSize: "1.65rem", color: "var(--forge-hot)" }}>
        Source Trust Gate
      </h2>
      <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
        Project: <strong>{project.name}</strong> — Scan sources, select trusted context, and confirm relevance.
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
        <button type="button" onClick={handleScanSources} disabled={isScanning}>
          {isScanning ? "Scanning Sources..." : "Scan Sources"}
        </button>
        <button
          type="button"
          onClick={handleConfirmManifest}
          disabled={sources.length === 0}
          style={{ borderColor: "#3f557f", background: "linear-gradient(180deg, #20304f 0%, #162542 100%)" }}
        >
          Confirm Source Manifest
        </button>
      </div>

      {sources.length === 0 ? (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          No sources yet. Run scan to discover candidates.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {sources.map((source) => (
            <label
              key={source.id}
              style={{
                display: "grid",
                gridTemplateColumns: "20px 1fr",
                alignItems: "start",
                gap: "0.55rem",
                border: "1px solid var(--forge-line)",
                borderRadius: "9px",
                padding: "0.48rem 0.55rem",
                background: "#0f1628",
              }}
            >
              <input
                type="checkbox"
                checked={selectedSourceIds.includes(source.id)}
                onChange={() => handleToggleSource(source.id)}
                style={{ width: "auto", marginTop: "0.18rem" }}
              />
              <span style={{ display: "grid", gap: "0.14rem", fontSize: "0.83rem", color: "var(--forge-muted)" }}>
                <strong style={{ color: "var(--forge-ink)" }}>{source.title}</strong>
                <span>{source.path}</span>
                <span>{source.type} | score {source.relevanceScore} | status {source.status}</span>
                {source.warnings.length > 0 ? (
                  <span style={{ color: "#f2a96a" }}>{source.warnings.join(" ")}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      )}

      <label style={{ display: "grid", gap: "0.24rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        Confirmation note
        <input
          value={confirmationNote}
          onChange={(e) => setConfirmationNote(e.target.value)}
          placeholder="Selected sources align with current product direction."
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.88rem", color: "var(--forge-muted)" }}>
        <input
          type="checkbox"
          checked={includeStaleConfirmed}
          onChange={(e) => setIncludeStaleConfirmed(e.target.checked)}
          style={{ width: "auto", margin: 0 }}
        />
        I understand stale or conflicting sources may degrade scenario quality.
      </label>

      {latestManifest ? (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.84rem", margin: 0 }}>
          Latest manifest: <strong>{latestManifest.id}</strong> (hash {latestManifest.manifestHash}).
        </p>
      ) : null}

      <a
        href={`/projects/${projectId}/generate`}
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
          opacity: latestManifest ? 1 : 0.55,
          pointerEvents: latestManifest ? "auto" : "none",
        }}
      >
        Create Scenarios →
      </a>
    </section>
  );
};
