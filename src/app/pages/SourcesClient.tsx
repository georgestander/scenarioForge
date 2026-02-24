"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectPrReadiness, SourceManifest, SourceRecord } from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type {
  CollectionPayload,
  ManifestCreatePayload,
  ProjectPrReadinessPayload,
} from "@/app/shared/types";

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
  const [prReadiness, setPrReadiness] = useState<ProjectPrReadiness | null>(null);
  const [isCheckingPrReadiness, setIsCheckingPrReadiness] = useState(false);

  const latestManifest = manifests[0] ?? null;
  const prReady = prReadiness?.status === "ready";

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

  const loadPrReadiness = async () => {
    const response = await fetch(`/api/projects/${projectId}/pr-readiness`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as ProjectPrReadinessPayload;
    setPrReadiness(payload.readiness ?? null);
  };

  const handleCheckPrReadiness = async () => {
    if (isCheckingPrReadiness) return;
    setIsCheckingPrReadiness(true);
    setStatusMessage("Checking PR automation readiness...");
    try {
      const response = await fetch(`/api/projects/${projectId}/pr-readiness`, {
        method: "POST",
      });
      if (!response.ok) {
        setStatusMessage(await readError(response, "Failed to check PR readiness."));
        return;
      }
      const payload = (await response.json()) as ProjectPrReadinessPayload;
      setPrReadiness(payload.readiness ?? null);
      if (payload.readiness?.status === "ready") {
        setStatusMessage("PR automation is ready.");
      } else {
        setStatusMessage("PR automation needs attention before full execute mode.");
      }
    } finally {
      setIsCheckingPrReadiness(false);
    }
  };

  useEffect(() => {
    void loadPrReadiness();
  }, []);

  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: "480px", margin: "0 auto", textAlign: "center" }}>
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

      <div
        style={{
          border: "1px solid var(--forge-line)",
          borderRadius: "8px",
          background: "rgba(18, 24, 43, 0.6)",
          padding: "0.55rem 0.65rem",
          display: "grid",
          gap: "0.35rem",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <strong style={{ color: "var(--forge-ink)", fontSize: "0.84rem" }}>
            PR automation readiness
          </strong>
          <span
            style={{
              fontSize: "0.75rem",
              color: prReady ? "var(--forge-ok)" : "var(--forge-fire)",
              fontWeight: 600,
            }}
          >
            {prReadiness ? (prReady ? "ready" : "needs attention") : "not checked"}
          </span>
        </div>
        {prReadiness?.reasons.length ? (
          <ul
            style={{
              margin: 0,
              paddingLeft: "1rem",
              color: "var(--forge-muted)",
              fontSize: "0.76rem",
              display: "grid",
              gap: "0.2rem",
            }}
          >
            {prReadiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: "var(--forge-muted)", fontSize: "0.76rem" }}>
            Use full execute mode only when readiness is green.
          </p>
        )}
        {prReadiness?.recommendedActions.length ? (
          <ul
            style={{
              margin: 0,
              paddingLeft: "1rem",
              color: "var(--forge-muted)",
              fontSize: "0.74rem",
              display: "grid",
              gap: "0.2rem",
            }}
          >
            {prReadiness.recommendedActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void handleCheckPrReadiness()} disabled={isCheckingPrReadiness}>
            {isCheckingPrReadiness ? "Checking..." : "Check PR readiness"}
          </button>
        </div>
      </div>

      {/* Buttons — always at top */}
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        {sources.length === 0 ? (
          <button
            type="button"
            onClick={() => void handleScanSources()}
            disabled={isScanning}
          >
            {isScanning ? "Scanning..." : "Scan sources"}
          </button>
        ) : (
          <>
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
            {latestManifest ? (
              <a
                href={`/projects/${projectId}/generate`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
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
          </>
        )}
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

      {/* Source list — scrollable */}
      {sources.length === 0 ? (
        <p style={{ color: "var(--forge-muted)", fontSize: "0.88rem", margin: 0 }}>
          No sources yet. Scan <strong style={{ color: "var(--forge-ink)" }}>{project.name}</strong> to discover planning docs.
        </p>
      ) : (
        <div style={{
          maxHeight: "calc(100vh - 320px)",
          minHeight: "120px",
          overflowY: "auto",
          display: "grid",
          gap: "0.5rem",
          textAlign: "left",
        }}>
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
                <span style={{ color: "var(--forge-muted)", fontSize: "0.74rem" }}>
                  status: {source.status}
                  {source.isConflicting ? " | conflicting" : ""}
                </span>
                {source.warnings.length > 0 ? (
                  <span style={{ color: "#f2a96a", fontSize: "0.74rem" }}>
                    {source.warnings.join(" ")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
};
