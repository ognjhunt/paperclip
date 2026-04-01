import { describe, expect, it, vi } from "vitest";
import { retryFindLiveExecutionIssueAfterConflict } from "../services/routines.ts";

describe("retryFindLiveExecutionIssueAfterConflict", () => {
  it("returns the issue when it becomes visible after a short delay", async () => {
    const issue = { id: "issue-1" };
    const lookup = vi
      .fn<() => Promise<typeof issue | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(issue);
    const sleepFn = vi.fn(async () => {});

    const result = await retryFindLiveExecutionIssueAfterConflict({
      lookup,
      attempts: 4,
      delayMs: 1,
      sleepFn,
    });

    expect(result).toEqual(issue);
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it("returns null after exhausting retries", async () => {
    const lookup = vi.fn<() => Promise<null>>().mockResolvedValue(null);
    const sleepFn = vi.fn(async () => {});

    const result = await retryFindLiveExecutionIssueAfterConflict({
      lookup,
      attempts: 3,
      delayMs: 1,
      sleepFn,
    });

    expect(result).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });
});
