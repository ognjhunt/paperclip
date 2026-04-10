import { describe, expect, it } from "vitest";
import { renderTaskBindingGuard, resolveBoundIssueId } from "./server-utils.js";

describe("server prompt guards", () => {
  it("extracts the bound issue id from task or issue context", () => {
    expect(resolveBoundIssueId({ taskId: "task-123", issueId: "issue-456" })).toBe("task-123");
    expect(resolveBoundIssueId({ issueId: "issue-456" })).toBe("issue-456");
    expect(resolveBoundIssueId({})).toBeNull();
  });

  it("renders a bound-task guard with canonical issue routes", () => {
    const note = renderTaskBindingGuard({ taskId: "task-123" });

    expect(note).toContain("This heartbeat is bound to issue task-123");
    expect(note).toContain("Do not scan the inbox, backlog, or other issues");
    expect(note).toContain("GET /api/issues/{id}/heartbeat-context");
    expect(note).toContain("PATCH /api/issues/{id}");
  });

  it("renders a binding-failure guard when wake context lacks a bound issue id", () => {
    const note = renderTaskBindingGuard({
      wakeReason: "managed_issue_created",
      wakeCommentId: "comment-123",
    });

    expect(note).toContain("does not include a bound issue id");
    expect(note).toContain("Do not compensate by scanning the inbox");
    expect(note).toContain("Report the binding failure and exit cleanly");
  });
});
