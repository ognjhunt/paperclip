import { describe, expect, it } from "vitest";
import { deriveAgentStatusFromActiveRunCounts } from "../services/heartbeat.ts";

describe("deriveAgentStatusFromActiveRunCounts", () => {
  it("treats queued work as active agent work", () => {
    expect(
      deriveAgentStatusFromActiveRunCounts({
        queuedCount: 1,
        runningCount: 0,
        outcome: "failed",
      }),
    ).toBe("running");
  });

  it("treats running work as active agent work", () => {
    expect(
      deriveAgentStatusFromActiveRunCounts({
        queuedCount: 0,
        runningCount: 1,
        outcome: "failed",
      }),
    ).toBe("running");
  });

  it("falls back to idle after a successful outcome with no active runs", () => {
    expect(
      deriveAgentStatusFromActiveRunCounts({
        queuedCount: 0,
        runningCount: 0,
        outcome: "succeeded",
      }),
    ).toBe("idle");
  });

  it("falls back to error after a failed outcome with no active runs", () => {
    expect(
      deriveAgentStatusFromActiveRunCounts({
        queuedCount: 0,
        runningCount: 0,
        outcome: "failed",
      }),
    ).toBe("error");
  });
});
