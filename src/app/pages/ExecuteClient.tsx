"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExecutionJob,
  ExecutionJobEvent,
  FixAttempt,
  Project,
  ProjectPrReadiness,
  ProjectPrReadinessReasonCode,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
} from "@/domain/models";
import { readError } from "@/app/shared/api";
import { DEFAULT_STATUS_MESSAGE, useSession } from "@/app/shared/SessionContext";
import type {
  ExecutionJobControlPayload,
  ExecutionJobDetailPayload,
  ExecutionJobEventsPayload,
  ExecutionJobStartPayload,
  ProjectPrReadinessPayload,
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

type ExecutionMode = "run" | "fix" | "pr" | "full";

const STATUS_ICON: Record<string, { char: string; color: string }> = {
  queued: { char: "\u2022", color: "var(--forge-muted)" },
  running: { char: "\u21BB", color: "var(--forge-fire)" },
  passed: { char: "\u2713", color: "var(--forge-ok)" },
  failed: { char: "\u2717", color: "#e25555" },
};

const STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  running: "in progress",
  passed: "passed",
  failed: "failed",
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
  pausing: "Pausing",
  paused: "Paused",
  stopping: "Stopping",
  cancelled: "Cancelled",
  completed: "Completed",
  failed: "Failed",
  blocked: "Failed",
};

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  run: "Run checks only",
  fix: "Run + fix loop",
  pr: "PR prep only",
  full: "Full loop (run/fix/rerun/PR)",
};

const EXECUTION_MODE_CTA: Record<ExecutionMode, string> = {
  run: "Run Checks",
  fix: "Run Fix Loop",
  pr: "Prepare PR Artifacts",
  full: "Run Full Loop",
};

const EXECUTION_MODE_RETRY_CTA: Record<ExecutionMode, string> = {
  run: "Retry Failed (Run)",
  fix: "Retry Failed (Fix)",
  pr: "Retry Failed (PR)",
  full: "Retry Failed (Full)",
};

const EXECUTION_MODE_PROMISE: Record<ExecutionMode, string> = {
  run: "Evidence bundle only (no fix or PR attempt).",
  fix: "Patch + evidence bundle (no PR attempt).",
  pr: "PR proposal metadata only.",
  full: "Patch + evidence + controller-attempted PR.",
};

const ACTUATOR_LABEL: Record<NonNullable<ProjectPrReadiness["fullPrActuator"]>, string> =
  {
    controller: "Controller-owned branch/push/PR",
    codex_git_workspace: "Codex git in workspace",
    codex_connector: "Codex GitHub connector",
    none: "No full PR actuator available",
  };

const REASON_CODE_LABEL: Record<ProjectPrReadinessReasonCode, string> = {
  CODEX_BRIDGE_UNREACHABLE: "Codex bridge is unavailable.",
  CODEX_ACCOUNT_NOT_AUTHENTICATED: "Codex account is not authenticated.",
  GITHUB_CONNECTION_MISSING: "GitHub app is not connected for this account.",
  GITHUB_REPO_NOT_CONFIGURED: "Project repository is not configured.",
  GITHUB_REPO_READ_DENIED: "GitHub installation cannot read this repository.",
  GITHUB_BRANCH_NOT_FOUND: "Configured branch cannot be accessed.",
  GITHUB_WRITE_PERMISSIONS_MISSING:
    "GitHub installation is missing write permissions.",
  SANDBOX_GIT_PROTECTED: "Sandbox policy blocks git write operations.",
  TOOL_SIDE_EFFECT_APPROVALS_UNSUPPORTED:
    "Tool side-effect approvals are not supported in this bridge mode.",
  PR_ACTUATOR_UNAVAILABLE: "No full PR actuator path is available.",
};

const PROBE_STEP_LABEL: Record<
  ProjectPrReadiness["probeResults"][number]["step"],
  string
> = {
  codex_bridge: "Codex bridge",
  codex_account: "Codex account",
  github_connection: "GitHub connection",
  repository_config: "Repository config",
  repository_access: "Repository access",
  branch_access: "Branch access",
  github_permissions: "GitHub permissions",
  actuator_path: "Actuator path",
};

const JOB_TERMINAL: ExecutionJob["status"][] = [
  "completed",
  "failed",
  "blocked",
  "cancelled",
];

const isJobActive = (job: ExecutionJob | null): boolean =>
  Boolean(
    job &&
      (job.status === "queued" ||
        job.status === "running" ||
        job.status === "pausing" ||
        job.status === "paused" ||
        job.status === "stopping"),
  );

const isFullModeReady = (readiness: ProjectPrReadiness | null): boolean =>
  Boolean(
    readiness &&
      readiness.status === "ready" &&
      readiness.fullPrActuator !== "none" &&
      readiness.reasonCodes.length === 0,
  );

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

const normalizeScenarioIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return [...new Set(ids)];
};

export const ExecuteClient = ({
  projectId,
  project: _project,
  initialPack,
  initialJob,
  initialReadiness,
}: {
  projectId: string;
  project: Project;
  initialPack: ScenarioPack;
  initialJob: ExecutionJob | null;
  initialReadiness: ProjectPrReadiness | null;
}) => {
  const { statusMessage, setStatusMessage } = useSession();
  const [isLaunching, setIsLaunching] = useState(false);
  const [controlAction, setControlAction] = useState<
    "pause" | "resume" | "stop" | null
  >(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingPrReadiness, setIsCheckingPrReadiness] = useState(false);
  const [executeInstruction, setExecuteInstruction] = useState(
    initialJob?.userInstruction ?? "",
  );
  const [prReadiness, setPrReadiness] = useState<ProjectPrReadiness | null>(
    initialReadiness ?? null,
  );
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    initialJob?.executionMode ??
      (isFullModeReady(initialReadiness ?? null) ? "full" : "fix"),
  );
  const [currentJob, setCurrentJob] = useState<ExecutionJob | null>(initialJob);
  const [jobEvents, setJobEvents] = useState<ExecutionJobEvent[]>([]);
  const [eventsCursor, setEventsCursor] = useState(0);
  const [latestRun, setLatestRun] = useState<ScenarioRun | null>(null);
  const [latestFix, setLatestFix] = useState<FixAttempt | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [traceMode, setTraceMode] = useState(false);
  const pollInFlightRef = useRef(false);
  const eventsCursorRef = useRef(0);
  const appliedSelectionFromJobRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const allScenarioIds = useMemo(
    () => initialPack.scenarios.map((scenario) => scenario.id),
    [initialPack.scenarios],
  );
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>(
    allScenarioIds,
  );

  useEffect(() => {
    setSelectedScenarioIds(allScenarioIds);
  }, [allScenarioIds]);

  useEffect(() => {
    if (!currentJob) {
      appliedSelectionFromJobRef.current = null;
      return;
    }
    if (appliedSelectionFromJobRef.current === currentJob.id) {
      return;
    }
    appliedSelectionFromJobRef.current = currentJob.id;
    const rawScenarioIds = normalizeScenarioIds(
      (currentJob.constraints as Record<string, unknown> | null)?.scenarioIds,
    );
    if (rawScenarioIds.length === 0) {
      return;
    }
    const allowed = new Set(allScenarioIds);
    const bounded = rawScenarioIds.filter((scenarioId) => allowed.has(scenarioId));
    if (bounded.length > 0) {
      setSelectedScenarioIds(bounded);
    }
  }, [allScenarioIds, currentJob?.constraints, currentJob?.id]);

  useEffect(() => {
    eventsCursorRef.current = eventsCursor;
  }, [eventsCursor]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setTraceMode(new URLSearchParams(window.location.search).get("trace") === "1");
  }, []);

  const fullModeReady = useMemo(() => isFullModeReady(prReadiness), [prReadiness]);
  const fullModeBlocked = executionMode === "full" && !fullModeReady;

  const refreshPrReadiness = useCallback(
    async (method: "GET" | "POST"): Promise<ProjectPrReadiness | null> => {
      const response = await fetch(`/api/projects/${projectId}/pr-readiness`, {
        method,
      });
      if (!response.ok) {
        throw new Error(
          await readError(response, "Failed to load PR readiness details."),
        );
      }
      const payload = (await response.json()) as ProjectPrReadinessPayload;
      const readiness = payload.readiness ?? null;
      setPrReadiness(readiness);
      return readiness;
    },
    [projectId],
  );

  const handleCheckPrReadiness = useCallback(async () => {
    if (isCheckingPrReadiness) {
      return;
    }
    setIsCheckingPrReadiness(true);
    setStatusMessage("Checking PR automation readiness...");
    try {
      const readiness = await refreshPrReadiness("POST");
      if (isFullModeReady(readiness)) {
        setStatusMessage("PR automation is ready for full mode.");
      } else {
        setStatusMessage(
          "Full mode is blocked until readiness checks pass. Use fix mode while blockers are being resolved.",
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to check PR readiness.",
      );
    } finally {
      setIsCheckingPrReadiness(false);
    }
  }, [isCheckingPrReadiness, refreshPrReadiness, setStatusMessage]);

  useEffect(() => {
    if (initialReadiness) {
      return;
    }
    void refreshPrReadiness("GET").catch(() => {
      // Existing status text and server-side gating handle stale readiness state.
    });
  }, [initialReadiness, refreshPrReadiness]);

  useEffect(() => {
    if (executionMode !== "full" || fullModeReady) {
      return;
    }
    if (isJobActive(currentJob)) {
      return;
    }
    setExecutionMode("fix");
  }, [currentJob, executionMode, fullModeReady]);

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
          // Keep scenario board and job summary visible even if event polling is flaky.
          return detail.job;
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

  const handleExecute = async (options?: {
    mode?: ExecutionMode;
    retryStrategy?: "failed_only" | "full";
    retryFromRunId?: string;
  }) => {
    if (isLaunching || isJobActive(currentJob)) {
      return;
    }

    const selectedSet = new Set(selectedScenarioIds);
    const scenarioIdsToRun = allScenarioIds.filter((scenarioId) =>
      selectedSet.has(scenarioId),
    );
    if (scenarioIdsToRun.length === 0) {
      setStatusMessage("Select at least one scenario before running execution.");
      return;
    }

    const mode = options?.mode ?? executionMode;
    const retryStrategy = options?.retryStrategy ?? "full";
    const retryFromRunId = options?.retryFromRunId ?? "";
    if (mode === "full" && !fullModeReady) {
      setExecutionMode("fix");
      setStatusMessage(
        "Full mode is blocked by PR readiness. Resolve blockers or run fix mode.",
      );
      return;
    }

    setIsLaunching(true);
    setStatusMessage(
      retryStrategy === "failed_only"
        ? `Queueing retry for failed scenarios (${EXECUTION_MODE_LABEL[mode].toLowerCase()})...`
        : `Queueing ${EXECUTION_MODE_LABEL[mode].toLowerCase()} background execution job...`,
    );

    try {
      const response = await fetch(
        `/api/projects/${projectId}/actions/execute/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarioPackId: initialPack.id,
            executionMode: mode,
            userInstruction: executeInstruction.trim(),
            scenarioIds: scenarioIdsToRun,
            retryStrategy,
            retryFromRunId: retryFromRunId || undefined,
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
      setExecutionMode(payload.job.executionMode);

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("jobId", payload.job.id);
        url.searchParams.set("packId", initialPack.id);
        window.history.replaceState({}, "", url.toString());
      }

      await syncJobState(payload.job.id, true);
      setStatusMessage(`Execution job ${payload.job.id} queued.`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to queue execution.",
      );
    } finally {
      setIsLaunching(false);
    }
  };

  const handleControl = async (action: "pause" | "resume" | "stop") => {
    if (!currentJob || controlAction) {
      return;
    }

    if (action === "stop") {
      const confirmed = window.confirm(
        "Stop this execution job? Partial progress will remain in audit history.",
      );
      if (!confirmed) {
        return;
      }
    }

    setControlAction(action);
    const progressLabel =
      action === "pause"
        ? "Requesting pause..."
        : action === "resume"
          ? "Resuming execution..."
          : "Requesting stop...";
    setStatusMessage(progressLabel);

    try {
      const response = await fetch(`/api/jobs/${currentJob.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to control execution job."));
      }

      const payload = (await response.json()) as ExecutionJobControlPayload;
      setCurrentJob(payload.job);
      await syncJobState(payload.job.id, false);
      setStatusMessage(payload.control.message);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to control execution job.",
      );
    } finally {
      setControlAction(null);
    }
  };

  const isExecuting = isLaunching || isJobActive(currentJob);
  const isControlling = controlAction !== null;
  const done = Boolean(currentJob && JOB_TERMINAL.includes(currentJob.status));
  const canPause = Boolean(
    currentJob &&
      (currentJob.status === "queued" ||
        currentJob.status === "running" ||
        currentJob.status === "pausing"),
  );
  const canResume = Boolean(
    currentJob &&
      (currentJob.status === "paused" || currentJob.status === "pausing"),
  );
  const canStop = Boolean(currentJob && !JOB_TERMINAL.includes(currentJob.status));
  const hasFailedScenarios = Boolean(latestRun && latestRun.summary.failed > 0);
  const activeJobId = currentJob && isJobActive(currentJob) ? currentJob.id : null;
  const visibleStatusMessage = useMemo(() => {
    const trimmed = statusMessage.trim();
    if (!trimmed || trimmed === DEFAULT_STATUS_MESSAGE) {
      return "";
    }
    if (trimmed.length <= 240) {
      return trimmed;
    }
    return `${trimmed.slice(0, 237)}...`;
  }, [statusMessage]);
  const jobErrorMessage = useMemo(() => {
    const raw = currentJob?.error?.trim() ?? "";
    if (!raw) {
      return "";
    }
    if (raw.length <= 280) {
      return raw;
    }
    return `${raw.slice(0, 277)}...`;
  }, [currentJob?.error]);

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

      const rawStatus = event.status === "blocked" ? "failed" : event.status;
      const normalizedStatus =
        rawStatus === "passed" ||
        rawStatus === "failed" ||
        rawStatus === "queued" ||
        rawStatus === "running"
          ? rawStatus
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
          row.status === "failed",
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
          row.status === "failed",
      ).length,
    [scenarioRows],
  );

  const liveScenarioMessage = useMemo(() => {
    if (!isExecuting) {
      return null;
    }

    if (currentJob?.status === "pausing") {
      return "Pause requested. Waiting for current step to stop.";
    }
    if (currentJob?.status === "paused") {
      return "Execution paused by user.";
    }
    if (currentJob?.status === "stopping") {
      return "Stop requested. Waiting for current step to halt.";
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
  }, [activeScenarioId, currentJob?.status, isExecuting, latestScenarioEvent, scenarioRows]);

  const panelHeight = "calc(100vh - 300px)";
  const selectedScenarioCount = useMemo(() => {
    const selected = new Set(selectedScenarioIds);
    return allScenarioIds.filter((scenarioId) => selected.has(scenarioId)).length;
  }, [allScenarioIds, selectedScenarioIds]);
  const readinessCheckedAtLabel = useMemo(() => {
    if (!prReadiness?.checkedAt) {
      return "";
    }
    const parsed = Date.parse(prReadiness.checkedAt);
    if (Number.isNaN(parsed)) {
      return prReadiness.checkedAt;
    }
    return new Date(parsed).toLocaleString();
  }, [prReadiness?.checkedAt]);
  const readinessDurationLabel = useMemo(() => {
    if (!prReadiness) {
      return "";
    }
    if (prReadiness.probeDurationMs < 1000) {
      return `${prReadiness.probeDurationMs}ms`;
    }
    return `${(prReadiness.probeDurationMs / 1000).toFixed(2)}s`;
  }, [prReadiness]);
  const readinessActuatorLabel =
    prReadiness?.fullPrActuator != null
      ? ACTUATOR_LABEL[prReadiness.fullPrActuator]
      : "Not checked";
  const readinessReasonCodeLabels = useMemo(
    () =>
      (prReadiness?.reasonCodes ?? []).map((reasonCode) => ({
        reasonCode,
        label: REASON_CODE_LABEL[reasonCode] ?? "Readiness check failed.",
      })),
    [prReadiness?.reasonCodes],
  );
  const executionModeDescription = useMemo(
    () => EXECUTION_MODE_LABEL[executionMode],
    [executionMode],
  );
  const executeCtaLabel = useMemo(
    () => EXECUTION_MODE_CTA[executionMode],
    [executionMode],
  );
  const retryCtaLabel = useMemo(
    () => EXECUTION_MODE_RETRY_CTA[executionMode],
    [executionMode],
  );
  const executionModePromise = useMemo(
    () => EXECUTION_MODE_PROMISE[executionMode],
    [executionMode],
  );
  const allSelected =
    allScenarioIds.length > 0 && selectedScenarioCount === allScenarioIds.length;
  const hasPartialSelection =
    selectedScenarioCount > 0 && selectedScenarioCount < allScenarioIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = hasPartialSelection;
    }
  }, [hasPartialSelection]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedScenarioIds([]);
      return;
    }
    setSelectedScenarioIds(allScenarioIds);
  };

  const toggleScenarioSelection = (scenarioId: string) => {
    setSelectedScenarioIds((current) => {
      if (current.includes(scenarioId)) {
        return current.filter((entry) => entry !== scenarioId);
      }
      return [...current, scenarioId];
    });
  };

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
        .execute-scenario-list {
          overflow-x: hidden;
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
        {currentJob?.status === "paused"
          ? "Execution Paused"
          : currentJob?.status === "pausing"
            ? "Pausing Execution"
            : currentJob?.status === "stopping"
              ? "Stopping Execution"
              : isExecuting
                ? "Running Scenarios"
                : done
                  ? "Execution Complete"
                  : "Execute Scenarios"}
      </h2>

      {visibleStatusMessage ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.84rem",
            color: "var(--forge-muted)",
          }}
        >
          {visibleStatusMessage}
        </p>
      ) : null}

      {jobErrorMessage ? (
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: "0.82rem",
            color: "#ffb2ad",
            border: "1px solid rgba(161, 71, 69, 0.45)",
            borderRadius: "7px",
            padding: "0.45rem 0.6rem",
            background: "rgba(161, 71, 69, 0.15)",
          }}
        >
          {jobErrorMessage}
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

      {scenarioRows.length > 0 ? (
        <div
          style={{
            height: "7px",
            borderRadius: "999px",
            background: "rgba(90, 110, 150, 0.35)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.round((completedCount / Math.max(scenarioRows.length, 1)) * 100)}%`,
              background:
                "linear-gradient(90deg, rgba(173, 90, 51, 0.95) 0%, rgba(245, 174, 104, 0.95) 100%)",
              transition: "width 0.2s ease",
            }}
          />
        </div>
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
          {latestRun.summary.passed} passed, {latestRun.summary.failed} failed.
          {latestFix ? " \u2014 fix attempted" : ""}
          {pullRequests.length > 0
            ? ` \u2014 ${pullRequests.length} PR${
                pullRequests.length > 1 ? "s" : ""
              } tracked`
            : ""}
        </p>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: "0.45rem",
          border: "1px solid var(--forge-line)",
          borderRadius: "8px",
          background: "rgba(18, 24, 43, 0.58)",
          padding: "0.55rem 0.65rem",
        }}
      >
        <div
          style={{
            border: "1px solid var(--forge-line)",
            borderRadius: "7px",
            padding: "0.5rem 0.6rem",
            display: "grid",
            gap: "0.35rem",
            background: "rgba(22, 30, 53, 0.48)",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <strong style={{ fontSize: "0.82rem", color: "var(--forge-ink)" }}>
              PR automation readiness
            </strong>
            <span
              style={{
                fontSize: "0.74rem",
                fontWeight: 600,
                color: fullModeReady ? "var(--forge-ok)" : "var(--forge-fire)",
              }}
            >
              {prReadiness
                ? fullModeReady
                  ? "ready"
                  : "blocked"
                : "not checked"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--forge-muted)" }}>
            Actuator path: {readinessActuatorLabel}
            {prReadiness?.checkedAt
              ? ` · checked ${readinessCheckedAtLabel} (${readinessDurationLabel})`
              : ""}
          </p>
          <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--forge-muted)" }}>
            {fullModeReady
              ? "Full mode is available."
              : "Full mode is disabled until readiness blockers are resolved. Manual handoff only."}
          </p>
          {readinessReasonCodeLabels.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: "1rem",
                display: "grid",
                gap: "0.15rem",
                fontSize: "0.72rem",
                color: "var(--forge-muted)",
              }}
            >
              {readinessReasonCodeLabels.map((entry) => (
                <li key={entry.reasonCode}>
                  <code>{entry.reasonCode}</code>: {entry.label}
                </li>
              ))}
            </ul>
          ) : null}
          {prReadiness?.reasons.length ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: "1rem",
                display: "grid",
                gap: "0.15rem",
                fontSize: "0.72rem",
                color: "var(--forge-muted)",
              }}
            >
              {prReadiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {prReadiness?.recommendedActions.length ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: "1rem",
                display: "grid",
                gap: "0.15rem",
                fontSize: "0.72rem",
                color: "var(--forge-muted)",
              }}
            >
              {prReadiness.recommendedActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void handleCheckPrReadiness()}
              disabled={isCheckingPrReadiness || isLaunching || isExecuting}
            >
              {isCheckingPrReadiness ? "Checking..." : "Check PR readiness"}
            </button>
          </div>
          {prReadiness ? (
            <details
              style={{
                border: "1px solid var(--forge-line)",
                borderRadius: "6px",
                padding: "0.35rem 0.45rem",
                background: "rgba(13, 20, 38, 0.45)",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  fontSize: "0.72rem",
                  color: "var(--forge-muted)",
                }}
              >
                Readiness probe details ({prReadiness.probeResults.length} checks)
              </summary>
              <ul
                style={{
                  margin: "0.35rem 0 0",
                  paddingLeft: "1rem",
                  display: "grid",
                  gap: "0.15rem",
                  fontSize: "0.7rem",
                  color: "var(--forge-muted)",
                }}
              >
                {prReadiness.probeResults.map((probe, index) => (
                  <li
                    key={`${probe.step}:${index}:${probe.reasonCode ?? "ok"}`}
                    style={{ lineHeight: 1.3 }}
                  >
                    <strong style={{ color: probe.ok ? "var(--forge-ok)" : "#ffb2ad" }}>
                      {PROBE_STEP_LABEL[probe.step] ?? probe.step}
                    </strong>{" "}
                    {probe.ok ? "ok" : "failed"}: {probe.message}
                    {probe.reasonCode ? ` [${probe.reasonCode}]` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <label
          style={{
            display: "grid",
            gap: "0.3rem",
            fontSize: "0.76rem",
            color: "var(--forge-muted)",
            textAlign: "left",
          }}
        >
          <span>Execution mode</span>
          <select
            value={executionMode}
            onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
            disabled={isLaunching || isExecuting}
            style={{ width: "100%" }}
          >
            <option value="run">{EXECUTION_MODE_LABEL.run}</option>
            <option value="fix">{EXECUTION_MODE_LABEL.fix}</option>
            <option value="pr">{EXECUTION_MODE_LABEL.pr}</option>
            <option value="full" disabled={!fullModeReady}>
              {EXECUTION_MODE_LABEL.full}
            </option>
          </select>
        </label>

        <p style={{ margin: 0, textAlign: "center", color: "var(--forge-muted)", fontSize: "0.74rem" }}>
          Selected mode: {executionModeDescription}
        </p>
        <p style={{ margin: 0, textAlign: "center", color: "var(--forge-muted)", fontSize: "0.74rem" }}>
          Promise: {executionModePromise}
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.7rem",
            flexWrap: "wrap",
            fontSize: "0.78rem",
            color: "var(--forge-muted)",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              cursor: isLaunching || isExecuting ? "not-allowed" : "pointer",
            }}
          >
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={isLaunching || isExecuting}
            />
            <span>Select all scenarios</span>
          </label>
          <span>
            {selectedScenarioCount}/{allScenarioIds.length} selected
          </span>
        </div>

        <input
          value={executeInstruction}
          onChange={(event) => setExecuteInstruction(event.target.value)}
          placeholder="Optional instruction"
          disabled={isLaunching || isExecuting}
          style={{ width: "100%", boxSizing: "border-box" }}
        />

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
            onClick={() => void handleExecute({ mode: executionMode, retryStrategy: "full" })}
            disabled={
              isLaunching ||
              isExecuting ||
              selectedScenarioCount === 0 ||
              fullModeBlocked
            }
            style={{ whiteSpace: "nowrap" }}
          >
            {isLaunching ? "Queueing..." : executeCtaLabel}
          </button>
          <button
            type="button"
            onClick={() =>
              void handleExecute({
                mode: executionMode,
                retryStrategy: "failed_only",
                retryFromRunId: latestRun?.id ?? "",
              })
            }
            disabled={
              isLaunching ||
              isExecuting ||
              !hasFailedScenarios ||
              selectedScenarioCount === 0 ||
              fullModeBlocked
            }
            style={{
              whiteSpace: "nowrap",
              borderColor: "#3f557f",
              background: "linear-gradient(180deg, #20304f 0%, #162542 100%)",
            }}
          >
            {retryCtaLabel}
          </button>
          {canPause ? (
            <button
              type="button"
              onClick={() => void handleControl("pause")}
              disabled={isControlling}
              style={{
                whiteSpace: "nowrap",
                borderColor: "#6d5a2d",
                background: "linear-gradient(180deg, #4a3f22 0%, #3b3018 100%)",
              }}
            >
              {controlAction === "pause" ? "Pausing..." : "Pause"}
            </button>
          ) : null}
          {canResume ? (
            <button
              type="button"
              onClick={() => void handleControl("resume")}
              disabled={isControlling}
              style={{
                whiteSpace: "nowrap",
                borderColor: "#2f6ba5",
                background: "linear-gradient(180deg, #1f4e7a 0%, #183d60 100%)",
              }}
            >
              {controlAction === "resume" ? "Resuming..." : "Resume"}
            </button>
          ) : null}
          {canStop ? (
            <button
              type="button"
              onClick={() => void handleControl("stop")}
              disabled={isControlling}
              style={{
                whiteSpace: "nowrap",
                borderColor: "#8a3d3d",
                background: "linear-gradient(180deg, #6b3030 0%, #512323 100%)",
              }}
            >
              {controlAction === "stop" ? "Stopping..." : "Stop"}
            </button>
          ) : null}
          {activeJobId ? (
            <a
              href={`/projects/${projectId}/execute?packId=${encodeURIComponent(initialPack.id)}&jobId=${encodeURIComponent(activeJobId)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 0.8rem",
                borderRadius: "7px",
                border: "1px solid var(--forge-line)",
                color: "var(--forge-ink)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.84rem",
              }}
            >
              Resume Active Run
            </a>
          ) : null}
          {done && latestRun ? (
            <a
              href={`/projects/${projectId}/completed`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 0.8rem",
                borderRadius: "7px",
                border: "1px solid #7f482b",
                background: "linear-gradient(180deg, #ad5a33 0%, #874423 100%)",
                color: "var(--forge-ink)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.84rem",
              }}
            >
              View Results
            </a>
          ) : null}
        </div>

        {isExecuting ? (
          <p style={{ margin: 0, textAlign: "center", color: "var(--forge-muted)", fontSize: "0.75rem" }}>
            {currentJob?.status === "paused"
              ? "Execution is paused. Resume or stop when you are ready."
              : currentJob?.status === "pausing"
                ? "Pausing execution. You can resume or stop after the current step halts."
                : currentJob?.status === "stopping"
                  ? "Stopping execution. Partial evidence will remain in job history."
                  : "Run continues in the background. You can leave this page and return anytime."}
          </p>
        ) : null}
      </div>

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
          const isSelected = selectedScenarioIds.includes(row.scenarioId);
          const displayStatus = isRunning && state === "queued" ? "running" : state;
          const icon = STATUS_ICON[displayStatus];
          const detailMessage =
            isRunning && state === "queued"
              ? "Executing current scenario..."
              : row.message;
          const displayMessage =
            detailMessage.length > 220
              ? `${detailMessage.slice(0, 217)}...`
              : detailMessage;

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
                  !isSelected && !isRunning
                    ? "rgba(32, 40, 62, 0.25)"
                    :
                  row.status === "passed"
                    ? "rgba(38, 91, 58, 0.2)"
                    : row.status === "failed"
                      ? "rgba(122, 49, 49, 0.18)"
                      : isRunning
                        ? "rgba(173, 90, 51, 0.13)"
                        : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleScenarioSelection(row.scenarioId)}
                disabled={isLaunching || isExecuting}
                style={{ marginTop: "0.15rem", flexShrink: 0 }}
                aria-label={`Select ${row.scenarioId}`}
              />

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
                      fontSize: "0.74rem",
                      fontWeight: 700,
                      color: "var(--forge-muted)",
                      flexShrink: 0,
                    }}
                  >
                    {row.scenarioId}
                  </span>
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
                    {displayMessage}
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
