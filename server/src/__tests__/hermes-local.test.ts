import { describe, expect, it } from "vitest";
import { hydrateHermesExecutionConfig } from "../adapters/hermes-local.js";

describe("hydrateHermesExecutionConfig", () => {
  it("maps wake context into the Hermes config shape and injects auth", () => {
    const hydrated = hydrateHermesExecutionConfig(
      {
        promptTemplate: "Continue your Paperclip work.",
        env: {
          PAPERCLIP_API_URL: "http://127.0.0.1:3100/api",
          EXTRA_FLAG: "1",
        },
      },
      {
        issueId: "issue-123",
        taskTitle: "Synthetic Canary",
        wakeCommentId: "comment-456",
        wakeReason: "issue_checked_out",
        projectName: "Blueprint Executive Ops",
      },
      "run-jwt-token",
    );

    expect(hydrated).toMatchObject({
      taskId: "issue-123",
      taskTitle: "Synthetic Canary",
      commentId: "comment-456",
      wakeReason: "issue_checked_out",
      projectName: "Blueprint Executive Ops",
    });
    expect(hydrated.env).toMatchObject({
      PAPERCLIP_API_URL: "http://127.0.0.1:3100/api",
      PAPERCLIP_API_KEY: "run-jwt-token",
      EXTRA_FLAG: "1",
    });
  });

  it("does not overwrite an explicit Hermes API key override", () => {
    const hydrated = hydrateHermesExecutionConfig(
      {
        env: {
          PAPERCLIP_API_KEY: "explicit-token",
        },
      },
      {
        taskId: "issue-999",
      },
      "run-jwt-token",
    );

    expect(hydrated.taskId).toBe("issue-999");
    expect((hydrated.env as Record<string, unknown>).PAPERCLIP_API_KEY).toBe("explicit-token");
  });

  it("prepends the bound-task guard into the task body for scoped wakes", () => {
    const hydrated = hydrateHermesExecutionConfig(
      {
        taskBody: "Resolve the assigned Paperclip issue.",
      },
      {
        taskId: "issue-321",
      },
      undefined,
    );

    expect(hydrated.taskBody).toContain("This heartbeat is bound to issue issue-321");
    expect(hydrated.taskBody).toContain("Resolve the assigned Paperclip issue.");
    expect(hydrated.taskBody).toContain("PATCH /api/issues/{id}");
  });
});
