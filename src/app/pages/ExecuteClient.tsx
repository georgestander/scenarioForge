"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExecutionJob,
  ExecutionJobEvent,
  FixAttempt,
  Project,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
} from "@/domain/models";
import { readError } from "@/app/shared/api";
import { useSession } from "@/app/shared/SessionContext";
import type {
  ExecutionJobDetailPayload,
  ExecutionJobEventsPayload,
  ExecutionJobStartPayload,
} from "@/app/shared/types";

interface ScenarioStatus {
  status: string;
  stage: string;
  message: string;
}

interface ScenarioRow {
  scenarioId: string;
  title: string;
  status: string;
  stage: string;
  message: string;
}

const STATUS_ICON: Record<string, { char: string; color: string }> = {
  queued: { char: "\u2022", color: "var(--forge-muted)" },
  running: { char: "\u21BB", color: "var(--forge-fire)" },
  passed: { char: "\u2713", color: "var(--forge-ok)" },
  failed: { char: "\u2717", color: "#e25555" },
  blocked: { char: "\u2014", color: "var(--forge-muted)" },
};

const STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  running: "in progress",
  passed: "passed",
  failed: "failed",
  blocked: "blocked",
};

const STAGE_LABEL: Record<string, string> = {
  run: "running checks",
  fix: "applying fix",
  rerun: "verifying fix",
  pr: "preparing PR",
};

const JOB_STATUS_LABEL: Record<ExecutionJob["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
};

const JOB_TERMINAL: ExecutionJob["status"][] = ["completed", "failed", "blocked"];

const isJobActive = (job: ExecutionJob | null): boolean =>
  Boolean(job && (job.status === "queued" || job.status === "running"));

const mergeEvents = (
  current: ExecutionJobEvent[],
  incoming: ExecutionJobEvent[],
): ExecutionJobEvent[] => {
  if (incoming.length === 0) {
    return current;
  }

  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }

  return Array.from(byId.values())
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-480);
};

export const ExecuteClient = ({
  projectId,
  project: _project,
  initialPack,
  initialJob,
}: {
  projectId: string;
  project: Project;
  initialPack: ScenarioPack;
  initialJob: ExecutionJob | null;
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const [isLaunching, setIsLaunching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [executeInstruction, setExecuteInstruction] = useState(
    initialJob?.userInstruction ?? "",
  );
  const [executionMode, setExecutionMode] = useState<
    "run" | "fix" | "pr" | "full"
  >(initialJob?.executionMode ?? "full");
  const [currentJob, setCurrentJob] = useState<ExecutionJob | null>(initialJob);
  const [jobEvents, setJobEvents] = useState<ExecutionJobEvent[]>([]);
  const [eventsCursor, setEventsCursor] = useState(0);
  const [latestRun, setLatestRun] = useState<ScenarioRun | null>(null);
  const [latestFix, setLatestFix] = useState<FixAttempt | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [traceMode, setTraceMode] = useState(false);
  const pollInFlightRef = useRef(false);
  const eventsCursorRef = useRef(0);

  useEffect(() => {
    eventsCursorRef.current = eventsCursor;
  }, [eventsCursor]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setTraceMode(new URLSearchParams(window.location.search).get("trace") === "1");
  }, []);

  const syncJobState = useCallback(
    async (jobId: string, resetCursor = false): Promise<ExecutionJob | null> => {
      const detailResponse = await fetch(`/api/jobs/${jobId}`);
      if (!detailResponse.ok) {
        throw new Error(
          await readError(detailResponse, "Failed to load execution job."),
        );
      }

      const detail = (await detailResponse.json()) as ExecutionJobDetailPayload;
      setCurrentJob(detail.job);
      setLatestRun(detail.run);
      setLatestFix(detail.fixAttempt);
      setPullRequests(detail.pullRequests);
      setExecutionMode(detail.job.executionMode);
      if (detail.job.userInstruction) {
        setExecuteInstruction(detail.job.userInstruction);
      }

      let cursor = resetCursor ? 0 : eventsCursorRef.current;
      let hasMore = true;
      let loops = 0;
      let merged: ExecutionJobEvent[] = resetCursor ? [] : [];

      while (hasMore) {
        const eventsResponse = await fetch(
          `/api/jobs/${jobId}/events?cursor=${cursor}&limit=120`,
        );
        if (!eventsResponse.ok) {
          throw new Error(
            await readError(eventsResponse, "Failed to load execution job events."),
          );
        }

        const eventsPayload =
          (await eventsResponse.json()) as ExecutionJobEventsPayload;
        if (eventsPayload.data.length > 0) {
          merged = [...merged, ...eventsPayload.data];
        }
        cursor = eventsPayload.nextCursor;
        hasMore = resetCursor && eventsPayload.hasMore && loops < 5;
        loops += 1;

        if (!resetCursor) {
          break;
        }
      }

      if (resetCursor) {
        setJobEvents(merged);
      } else if (merged.length > 0) {
        setJobEvents((current) => mergeEvents(current, merged));
      }

      setEventsCursor(cursor);
      eventsCursorRef.current = cursor;
      return detail.job;
    },
    [],
  );

  useEffect(() => {
    if (!initialJob) {
      return;
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("jobId", initialJob.id);
      window.history.replaceState({}, "", url.toString());
    }

    void syncJobState(initialJob.id, true).catch((error) => {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to restore existing execution job.",
      );
    });
  }, []);

  useEffect(() => {
    if (!currentJob) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled || pollInFlightRef.current) {
        return;
      }

      pollInFlightRef.current = true;
      setIsRefreshing(true);
      try {
        await syncJobState(currentJob.id, false);
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(
            error instanceof Error ? error.message : "Failed to sync execution job.",
          );
        }
      } finally {
        pollInFlightRef.current = false;
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    };

    void poll();
    const intervalMs = isJobActive(currentJob) ? 2000 : 7000;
    const timer = window.setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentJob?.id, currentJob?.status, setStatusMessage, syncJobState]);

  useEffect(() => {
    if (!currentJob) {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncJobState(currentJob.id, false).catch(() => {
          // Poll loop will report persistent errors.
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [currentJob?.id, syncJobState]);

  const handleExecute = async () => {
    if (isLaunching || isJobActive(currentJob)) {
      return;
    }

    setIsLaunching(true);
    setStatusMessage("Queueing background execution job...");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/actions/execute/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarioPackId: initialPack.id,
            executionMode,
            userInstruction: executeInstruction.trim(),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await readError(response, "Failed to queue background execution."),
        );
      }

      const payload = (await response.json()) as ExecutionJobStartPayload;
      setCurrentJob(payload.job);
      setLatestRun(null);
      setLatestFix(null);
      setPullRequests([]);
      setJobEvents([]);
      setEventsCursor(0);
      eventsCursorRef.current = 0;

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("jobId", payload.job.id);
        window.history.replaceState({}, "", url.toString());
      }

      await syncJobState(payload.job.id, true);
      setStatusMessage(
        `Execution job ${payload.job.id} queued (${payload.activeCount}/${payload.activeLimit} active).`,
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to queue execution.",
      );
    } finally {
      setIsLaunching(false);
    }
  };

  const isExecuting = isLaunching || isJobActive(currentJob);
  const done = Boolean(currentJob && JOB_TERMINAL.includes(currentJob.status));

  const filteredEvents = useMemo(
    () =>
      jobEvents.filter((event) => {
        const message = event.message;
        if (message === event.event) {
          return false;
        }
        if (message.includes("/") && !message.includes(" ")) {
          return false;
        }
        return true;
      }),
    [jobEvents],
  );

  const displayEvents = useMemo(() => {
    if (traceMode) {
      return jobEvents;
    }
    if (filteredEvents.length > 0) {
      return filteredEvents;
    }
    return jobEvents;
  }, [traceMode, filteredEvents, jobEvents]);

  const hiddenEventCount = Math.max(jobEvents.length - filteredEvents.length, 0);
  const scenarioEvents = useMemo(
    () =>
      jobEvents.filter((event) => event.event === "status" && Boolean(event.scenarioId)),
    [jobEvents],
  );

  const latestScenarioEvent = useMemo(() => {
    if (scenarioEvents.length === 0) {
      return null;
    }

    for (let index = scenarioEvents.length - 1; index >= 0; index -= 1) {
      const event = scenarioEvents[index];
      if (event.status === "running") {
        return event;
      }
    }

    return scenarioEvents[scenarioEvents.length - 1] ?? null;
  }, [scenarioEvents]);

  const scenarioStatuses = useMemo(() => {
    const map = new Map<string, ScenarioStatus>();
    for (const event of jobEvents) {
      if (!event.scenarioId) {
        continue;
      }

      const normalizedStatus =
        event.status === "passed" ||
        event.status === "failed" ||
        event.status === "blocked" ||
        event.status === "queued" ||
        event.status === "running"
          ? event.status
          : "running";

      map.set(event.scenarioId, {
        status: normalizedStatus,
        stage: event.stage ?? "run",
        message: event.message,
      });
    }

    return map;
  }, [jobEvents]);

  const finalStatuses = useMemo(() => {
    if (!latestRun) {
      return scenarioStatuses;
    }

    const map = new Map(scenarioStatuses);
    for (const item of latestRun.items) {
      map.set(item.scenarioId, {
        status: item.status,
        stage: "run",
        message:
          item.observed ||
          (item.status === "passed"
            ? "Passed"
            : item.failureHypothesis ?? ""),
      });
    }

    return map;
  }, [latestRun, scenarioStatuses]);

  const scenarioRows = useMemo<ScenarioRow[]>(() => {
    return initialPack.scenarios.map((scenario, index) => {
      const info = finalStatuses.get(scenario.id);
      const fallbackRunning =
        isExecuting && jobEvents.length === 0 && index === 0;
      const status = info?.status ?? (fallbackRunning ? "running" : "queued");
      const stage = info?.stage ?? "run";
      const message =
        info?.message ??
        (status === "running"
          ? "Starting execution..."
          : "Waiting in queue for prior scenarios to finish.");

      return {
        scenarioId: scenario.id,
        title: scenario.title,
        status,
        stage,
        message,
      };
    });
  }, [finalStatuses, initialPack.scenarios, isExecuting, jobEvents.length]);

  const activeScenarioId = useMemo(() => {
    const running = scenarioRows.find((row) => row.status === "running");
    if (running) {
      return running.scenarioId;
    }

    if (isExecuting) {
      const completedCount = scenarioRows.filter(
        (row) =>
          row.status === "passed" ||
          row.status === "failed" ||
          row.status === "blocked",
      ).length;
      const activeIndex = Math.min(
        completedCount,
        Math.max(scenarioRows.length - 1, 0),
      );
      return scenarioRows[activeIndex]?.scenarioId ?? null;
    }

    return null;
  }, [isExecuting, scenarioRows]);

  const completedCount = useMemo(
    () =>
      scenarioRows.filter(
        (row) =>
          row.status === "passed" ||
          row.status === "failed" ||
          row.status === "blocked",
      ).length,
    [scenarioRows],
  );

  const liveScenarioMessage = useMemo(() => {
    if (!isExecuting) {
      return null;
    }

    const active =
      scenarioRows.find((row) => row.status === "running") ??
      (activeScenarioId
        ? scenarioRows.find((row) => row.scenarioId === activeScenarioId) ?? null
        : null);
    if (!active) {
      return "Finalizing scenario outcomes...";
    }

    const eventMessage =
      latestScenarioEvent && latestScenarioEvent.scenarioId === active.scenarioId
        ? latestScenarioEvent.message
        : active.message;
    const stageLabel =
      active.stage && active.status === "running"
        ? STAGE_LABEL[active.stage] ?? active.stage
        : STATUS_LABEL[active.status] ?? active.status;

    return `${active.scenarioId}: ${stageLabel}. ${eventMessage}`;
  }, [activeScenarioId, isExecuting, latestScenarioEvent, scenarioRows]);

  const panelHeight = "calc(100vh - 300px)";

  return (
    <section
      style={{
        margin: "0 auto",
        padding: "1.5rem 1rem",
        display: "grid",
        gap: "1rem",
      }}
    >
      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .execute-panels {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 220px;
          gap: 0.75rem;
          align-items: start;
        }
        .execute-scenario-list {
          overflow-x: hidden;
        }
        .execute-stream-log {
          width: 220px;
          max-width: 220px;
          justify-self: end;
          overflow-x: hidden;
        }
        .execute-stream-log li {
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        @media (max-width: 960px) {
          .execute-panels {
            grid-template-columns: 1fr;
          }
          .execute-stream-log {
            width: 100%;
            max-width: none;
            justify-self: stretch;
            border-left: none !important;
            border-top: 1px solid var(--forge-line);
            padding-top: 0.65rem;
          }
        }
      `}</style>

      <h2
        style={{
          textAlign: "center",
          margin: 0,
          fontFamily: "'VT323', monospace",
          fontSize: "1.5rem",
          color: "var(--forge-ink)",
        }}
      >
        {isExecuting
          ? "Running Scenarios"
          : done
            ? "Execution Complete"
            : "Execute Scenarios"}
      </h2>

      {statusMessage ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.84rem",
            color: "var(--forge-muted)",
          }}
        >
          {statusMessage}
        </p>
      ) : null}

      {currentJob ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.78rem",
            color: "var(--forge-muted)",
          }}
        >
          Job <code>{currentJob.id}</code> · {JOB_STATUS_LABEL[currentJob.status]}
          {isRefreshing ? " · syncing..." : ""}
        </p>
      ) : null}

      {scenarioRows.length > 0 ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.82rem",
            color: "var(--forge-muted)",
          }}
        >
          {completedCount}/{scenarioRows.length} scenarios finalized
          {liveScenarioMessage ? ` · Now: ${liveScenarioMessage}` : ""}
        </p>
      ) : null}

      {!traceMode && hiddenEventCount > 0 && filteredEvents.length > 0 ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.75rem",
            color: "var(--forge-muted)",
          }}
        >
          Raw codex event stream hidden ({hiddenEventCount} low-level events). Add{" "}
          <code>?trace=1</code> for diagnostics.
        </p>
      ) : null}

      {done && latestRun ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.84rem",
            color: "var(--forge-muted)",
          }}
        >
          {latestRun.summary.passed} passed, {latestRun.summary.failed} failed,{" "}
          {latestRun.summary.blocked} blocked
          {latestFix ? " \u2014 fix attempted" : ""}
          {pullRequests.length > 0
            ? ` \u2014 ${pullRequests.length} PR${
                pullRequests.length > 1 ? "s" : ""
              } tracked`
            : ""}
        </p>
      ) : null}

      {!isExecuting ? (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            justifyContent: "center",
            alignItems: "end",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "grid",
              gap: "0.2rem",
              fontSize: "0.75rem",
              color: "var(--forge-muted)",
            }}
          >
            Mode
            <select
              value={executionMode}
              onChange={(event) =>
                setExecutionMode(
                  event.target.value as "run" | "fix" | "pr" | "full",
                )
              }
              disabled={isLaunching}
              style={{ minWidth: "120px" }}
            >
              <option value="run">run only</option>
              <option value="fix">run + fix</option>
              <option value="pr">run + fix + pr</option>
              <option value="full">full loop</option>
            </select>
          </label>
          <input
            value={executeInstruction}
            onChange={(event) => setExecuteInstruction(event.target.value)}
            placeholder="Optional instruction"
            disabled={isLaunching}
            style={{ flex: 1, minWidth: "140px", boxSizing: "border-box" }}
          />
          <button
            type="button"
            onClick={() => void handleExecute()}
            disabled={isLaunching}
            style={{ whiteSpace: "nowrap", padding: "0.55rem 1.2rem" }}
          >
            {isLaunching ? "Queueing..." : "Start Background Run"}
          </button>
          {done && latestRun ? (
            <a
              href={`/projects/${projectId}/completed`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 1.2rem",
                borderRadius: "7px",
                border: "1px solid #7f482b",
                background:
                  "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
                color: "var(--forge-ink)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              View Results
            </a>
          ) : null}
        </div>
      ) : null}

      <div
        className="execute-scenario-list"
        style={{
          maxHeight: panelHeight,
          minHeight: "120px",
          overflowY: "auto",
          display: "grid",
          gap: "0.25rem",
          alignContent: "start",
        }}
      >
        {scenarioRows.map((row) => {
          const state = row.status;
          const isRunning = activeScenarioId === row.scenarioId;
          const displayStatus = isRunning && state === "queued" ? "running" : state;
          const icon = STATUS_ICON[displayStatus];
          const detailMessage =
            isRunning && state === "queued"
              ? "Executing current scenario..."
              : row.message;

          return (
            <div
              key={row.scenarioId}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.4rem 0.55rem",
                borderRadius: "6px",
                border: isRunning
                  ? "1px solid var(--forge-fire)"
                  : "1px solid var(--forge-line)",
                background:
                  row.status === "passed"
                    ? "rgba(38, 91, 58, 0.2)"
                    : row.status === "failed"
                      ? "rgba(122, 49, 49, 0.18)"
                      : row.status === "blocked"
                        ? "rgba(74, 84, 112, 0.16)"
                        : isRunning
                          ? "rgba(173, 90, 51, 0.13)"
                          : "transparent",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: "1.1rem",
                  textAlign: "center",
                  fontSize: "0.88rem",
                  lineHeight: "1.3",
                  color: icon?.color ?? "var(--forge-muted)",
                  animation: isRunning
                    ? "pulse 1.4s ease-in-out infinite"
                    : undefined,
                }}
              >
                {icon?.char ?? "\u25CB"}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      color: "var(--forge-ink)",
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {row.title}
                  </span>
                  {displayStatus === "running" ? (
                    <span
                      style={{
                        fontSize: "0.68rem",
                        color: "var(--forge-fire)",
                        flexShrink: 0,
                      }}
                    >
                      {row.stage ? STAGE_LABEL[row.stage] ?? row.stage : "running checks"}
                    </span>
                  ) : null}
                  {displayStatus !== "running" ? (
                    <span
                      style={{
                        fontSize: "0.68rem",
                        color: icon?.color ?? "var(--forge-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {STATUS_LABEL[displayStatus] ?? displayStatus}
                    </span>
                  ) : null}
                </div>
                {detailMessage ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.72rem",
                      color: "var(--forge-muted)",
                      lineHeight: 1.35,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {detailMessage}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {traceMode ? (
        <details
          style={{
            border: "1px solid var(--forge-line)",
            borderRadius: "8px",
            padding: "0.5rem 0.7rem",
            background: "rgba(15, 21, 43, 0.45)",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.78rem",
              color: "var(--forge-muted)",
              userSelect: "none",
            }}
          >
            Raw stream diagnostics ({displayEvents.length} events)
          </summary>
          <ul
            style={{
              margin: "0.45rem 0 0",
              padding: 0,
              listStyle: "none",
              maxHeight: "180px",
              overflowY: "auto",
              display: "grid",
              gap: "0.15rem",
              alignContent: "start",
              fontSize: "0.72rem",
              color: "var(--forge-muted)",
            }}
          >
            {displayEvents.length > 0 ? (
              displayEvents.map((event) => (
                <li key={event.id} style={{ lineHeight: 1.3 }}>
                  <span style={{ color: "var(--forge-fire)" }}>*</span> {event.message}
                  {event.scenarioId || event.status || event.stage ? (
                    <span style={{ color: "var(--forge-muted)" }}>
                      {" "}
                      [{event.scenarioId ?? "-"} | {event.stage ?? "-"} |{" "}
                      {event.status ?? "-"}]
                    </span>
                  ) : null}
                </li>
              ))
            ) : (
              <li style={{ color: "var(--forge-muted)", fontStyle: "italic" }}>
                No raw diagnostics yet.
              </li>
            )}
          </ul>
        </details>
      ) : null}
    </section>
  );
};
