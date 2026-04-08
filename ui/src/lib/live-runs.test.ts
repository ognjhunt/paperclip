import { describe, expect, it } from "vitest";
import {
  countRunningLiveRuns,
  countRunningLiveRunsByAgent,
  isOpenLiveRun,
  isRunningLiveRun,
  shouldPollPersistedRunLog,
} from "./live-runs";

describe("live-runs helpers", () => {
  it("treats only running runs as live", () => {
    expect(isRunningLiveRun("running")).toBe(true);
    expect(isRunningLiveRun("queued")).toBe(false);
    expect(isOpenLiveRun("queued")).toBe(true);
    expect(isOpenLiveRun("running")).toBe(true);
    expect(isOpenLiveRun("failed")).toBe(false);
  });

  it("counts only running runs in live badges", () => {
    const runs = [
      { agentId: "agent-1", status: "running" },
      { agentId: "agent-1", status: "queued" },
      { agentId: "agent-2", status: "running" },
      { agentId: "agent-2", status: "failed" },
    ] as const;

    expect(countRunningLiveRuns(runs as never)).toBe(2);
    expect(countRunningLiveRunsByAgent(runs as never)).toEqual(
      new Map([
        ["agent-1", 1],
        ["agent-2", 1],
      ]),
    );
  });

  it("skips persisted log polling for queued or terminal runs without a log ref", () => {
    expect(shouldPollPersistedRunLog({ status: "running", logRef: null })).toBe(true);
    expect(shouldPollPersistedRunLog({ status: "queued", logRef: null })).toBe(false);
    expect(shouldPollPersistedRunLog({ status: "failed", logRef: null })).toBe(false);
    expect(shouldPollPersistedRunLog({ status: "succeeded", logRef: "run-1.ndjson" })).toBe(true);
  });
});
