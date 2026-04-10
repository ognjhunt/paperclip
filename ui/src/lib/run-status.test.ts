// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { HeartbeatRun, HeartbeatRunEvent } from "@paperclipai/shared";
import {
  deriveEffectiveHeartbeatRun,
  hasTerminalLifecycleEvent,
  isLiveHeartbeatRunStatus,
  mergeHeartbeatRunEvents,
} from "./run-status";

function makeRun(overrides: Partial<HeartbeatRun> = {}): HeartbeatRun {
  return {
    id: "run-1",
    companyId: "company-1",
    agentId: "agent-1",
    invocationSource: "automation",
    triggerDetail: "system",
    status: "running",
    startedAt: new Date("2026-04-10T00:00:00.000Z"),
    finishedAt: null,
    error: null,
    wakeupRequestId: null,
    exitCode: 0,
    signal: null,
    usageJson: null,
    resultJson: null,
    sessionIdBefore: null,
    sessionIdAfter: null,
    logStore: null,
    logRef: null,
    logBytes: null,
    logSha256: null,
    logCompressed: false,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    errorCode: null,
    externalRunId: null,
    processPid: null,
    processStartedAt: null,
    retryOfRunId: null,
    processLossRetryCount: 0,
    contextSnapshot: null,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    ...overrides,
  };
}

function makeEvent(seq: number, status: string): HeartbeatRunEvent {
  return {
    id: seq,
    companyId: "company-1",
    runId: "run-1",
    agentId: "agent-1",
    seq,
    eventType: "lifecycle",
    stream: "system",
    level: status === "succeeded" ? "info" : "error",
    color: null,
    message: `run ${status}`,
    payload: { status },
    createdAt: new Date(`2026-04-10T00:00:0${seq}.000Z`),
  };
}

describe("run status helpers", () => {
  it("treats queued and running as live statuses", () => {
    expect(isLiveHeartbeatRunStatus("queued")).toBe(true);
    expect(isLiveHeartbeatRunStatus("running")).toBe(true);
    expect(isLiveHeartbeatRunStatus("succeeded")).toBe(false);
  });

  it("derives a terminal run state from lifecycle events", () => {
    const run = deriveEffectiveHeartbeatRun(makeRun(), [makeEvent(2, "succeeded")]);

    expect(run.status).toBe("succeeded");
    expect(run.finishedAt?.toISOString()).toBe("2026-04-10T00:00:02.000Z");
  });

  it("merges run events by sequence without duplicates", () => {
    const merged = mergeHeartbeatRunEvents(
      [makeEvent(1, "running")],
      [makeEvent(1, "running"), makeEvent(2, "succeeded")],
    );

    expect(merged.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("detects terminal lifecycle events", () => {
    expect(hasTerminalLifecycleEvent([makeEvent(2, "succeeded")])).toBe(true);
    expect(hasTerminalLifecycleEvent([makeEvent(1, "running")])).toBe(false);
  });
});
