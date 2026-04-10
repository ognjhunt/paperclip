import { describe, expect, it } from "vitest";
import { resolveBoundIssueIdFromContextSnapshot } from "../services/activity.js";

describe("activity service helpers", () => {
  it("prefers taskId over issueId when resolving a bound issue", () => {
    expect(
      resolveBoundIssueIdFromContextSnapshot({
        taskId: "issue-task-123",
        issueId: "issue-context-456",
      }),
    ).toBe("issue-task-123");
  });

  it("falls back to issueId when taskId is absent", () => {
    expect(
      resolveBoundIssueIdFromContextSnapshot({
        issueId: "issue-context-456",
      }),
    ).toBe("issue-context-456");
  });

  it("returns null when no bound issue exists in the context snapshot", () => {
    expect(resolveBoundIssueIdFromContextSnapshot({ wakeReason: "execution_dispatch" })).toBeNull();
  });
});
