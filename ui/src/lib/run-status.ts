import type { HeartbeatRun, HeartbeatRunEvent, HeartbeatRunStatus } from "@paperclipai/shared";

const TERMINAL_RUN_STATUSES = new Set<HeartbeatRunStatus>([
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
]);

export function isLiveHeartbeatRunStatus(status: HeartbeatRunStatus): boolean {
  return status === "queued" || status === "running";
}

function readHeartbeatRunStatus(value: unknown): HeartbeatRunStatus | null {
  if (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function readLifecycleEventStatus(event: HeartbeatRunEvent): HeartbeatRunStatus | null {
  if (event.eventType !== "lifecycle") return null;

  const payloadStatus = readHeartbeatRunStatus(event.payload?.status);
  if (payloadStatus) return payloadStatus;

  const message = event.message?.trim().toLowerCase() ?? "";
  if (message === "run succeeded") return "succeeded";
  if (message === "run failed") return "failed";
  if (message === "run timed_out") return "timed_out";
  if (message === "run cancelled") return "cancelled";
  return null;
}

export function deriveEffectiveHeartbeatRun(
  run: HeartbeatRun,
  events: HeartbeatRunEvent[] | null | undefined,
): HeartbeatRun {
  if (!isLiveHeartbeatRunStatus(run.status)) return run;

  const terminalEvent = [...(events ?? [])]
    .sort((a, b) => b.seq - a.seq)
    .find((event) => {
      const status = readLifecycleEventStatus(event);
      return status !== null && TERMINAL_RUN_STATUSES.has(status);
    });

  if (!terminalEvent) return run;

  const status = readLifecycleEventStatus(terminalEvent);
  if (!status) return run;

  return {
    ...run,
    status,
    finishedAt: run.finishedAt ?? terminalEvent.createdAt,
    updatedAt: terminalEvent.createdAt,
    error:
      status === "failed" || status === "timed_out" || status === "cancelled"
        ? run.error ?? terminalEvent.message ?? null
        : run.error,
  };
}

export function mergeHeartbeatRunEvents(
  existing: HeartbeatRunEvent[] | null | undefined,
  incoming: HeartbeatRunEvent[] | null | undefined,
): HeartbeatRunEvent[] {
  const merged = new Map<number, HeartbeatRunEvent>();

  for (const event of existing ?? []) {
    merged.set(event.seq, event);
  }
  for (const event of incoming ?? []) {
    merged.set(event.seq, event);
  }

  return [...merged.values()].sort((a, b) => a.seq - b.seq);
}

export function hasTerminalLifecycleEvent(events: HeartbeatRunEvent[] | null | undefined): boolean {
  return (events ?? []).some((event) => {
    const status = readLifecycleEventStatus(event);
    return status !== null && TERMINAL_RUN_STATUSES.has(status);
  });
}
