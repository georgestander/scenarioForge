"use client";

import { useCallback, useState } from "react";
import type { CodexStreamEventLog } from "./types.js";
import { parseSsePayload, readError, readStreamError } from "./api.js";

export const useStreamAction = () => {
  const [codexStreamEvents, setCodexStreamEvents] = useState<CodexStreamEventLog[]>([]);

  const appendStreamEvent = useCallback(
    (action: "generate" | "execute", event: string, payload: unknown) => {
      const record =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : null;
      const nested =
        record?.payload && typeof record.payload === "object"
          ? (record.payload as Record<string, unknown>)
          : null;
      const deep =
        nested?.payload && typeof nested.payload === "object"
          ? (nested.payload as Record<string, unknown>)
          : null;

      const phase =
        (typeof record?.phase === "string" && record.phase.trim()) ||
        (typeof nested?.phase === "string" && nested.phase.trim()) ||
        (typeof deep?.phase === "string" && deep.phase.trim()) ||
        (typeof nested?.event === "string" && nested.event.trim()) ||
        event;
      const message =
        (typeof record?.message === "string" && record.message.trim()) ||
        (typeof nested?.message === "string" && nested.message.trim()) ||
        (typeof deep?.message === "string" && deep.message.trim()) ||
        (typeof record?.error === "string" && record.error.trim()) ||
        (typeof nested?.error === "string" && nested.error.trim()) ||
        (typeof deep?.error === "string" && deep.error.trim()) ||
        (typeof nested?.event === "string" && nested.event.trim()) ||
        event;
      const timestamp =
        (typeof record?.timestamp === "string" && record.timestamp.trim()) ||
        (typeof nested?.timestamp === "string" && nested.timestamp.trim()) ||
        (typeof deep?.timestamp === "string" && deep.timestamp.trim()) ||
        new Date().toISOString();

      const scenarioId =
        (typeof record?.scenarioId === "string" && record.scenarioId.trim()) ||
        (typeof nested?.scenarioId === "string" && nested.scenarioId.trim()) ||
        (typeof deep?.scenarioId === "string" && deep.scenarioId.trim()) ||
        undefined;
      const stage =
        (typeof record?.stage === "string" && record.stage.trim()) ||
        (typeof nested?.stage === "string" && nested.stage.trim()) ||
        (typeof deep?.stage === "string" && deep.stage.trim()) ||
        undefined;
      const status =
        (typeof record?.status === "string" && record.status.trim()) ||
        (typeof nested?.status === "string" && nested.status.trim()) ||
        (typeof deep?.status === "string" && deep.status.trim()) ||
        undefined;

      setCodexStreamEvents((current) => [
        ...current.slice(-119),
        {
          id: `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          action,
          event,
          phase,
          message,
          timestamp,
          scenarioId: scenarioId || undefined,
          stage: stage || undefined,
          status: status || undefined,
        },
      ]);
    },
    [],
  );

  const streamAction = useCallback(
    async <TPayload,>(
      action: "generate" | "execute",
      url: string,
      body: Record<string, unknown>,
      fallbackErrorMessage: string,
    ): Promise<TPayload> => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await readError(response, fallbackErrorMessage));
      }

      if (!response.body) {
        throw new Error("Streaming response body unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";
      let dataLines: string[] = [];
      let completedPayload: TPayload | null = null;

      const dispatchEvent = () => {
        if (dataLines.length === 0) {
          currentEvent = "message";
          return;
        }

        const payload = parseSsePayload(dataLines.join("\n"));
        appendStreamEvent(action, currentEvent, payload);

        if (currentEvent === "error") {
          throw new Error(readStreamError(payload, fallbackErrorMessage));
        }

        if (currentEvent === "completed") {
          completedPayload = payload as TPayload;
        }

        currentEvent = "message";
        dataLines = [];
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }

          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim() || "message";
            continue;
          }

          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
            continue;
          }

          if (line === "") {
            dispatchEvent();
          }
        }
      }

      if (dataLines.length > 0) {
        dispatchEvent();
      }

      if (!completedPayload) {
        throw new Error(`${action} stream ended before completion payload.`);
      }

      return completedPayload;
    },
    [appendStreamEvent],
  );

  const clearStreamEvents = useCallback(() => {
    setCodexStreamEvents([]);
  }, []);

  return { streamAction, codexStreamEvents, clearStreamEvents, appendStreamEvent };
};
