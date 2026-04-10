import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getAncestors: vi.fn(),
  getCommentCursor: vi.fn(),
  getComment: vi.fn(),
  update: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(async () => ({})),
  }),
  executionWorkspaceService: () => ({
    getById: vi.fn(),
  }),
  goalService: () => ({
    getById: vi.fn(async () => null),
    getDefaultCompanyGoal: vi.fn(async () => null),
  }),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => ({
    getById: vi.fn(async () => null),
    listByIds: vi.fn(async () => []),
  }),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({
    listForIssue: vi.fn(async () => []),
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      companyIds: ["company-1"],
      source: "agent_api_key",
      isInstanceAdmin: false,
      runId: "run-1",
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

const issue = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "company-1",
  identifier: "PAP-777",
  title: "Bound issue",
  description: "Handle only this task",
  status: "todo",
  priority: "high",
  projectId: null,
  goalId: null,
  parentId: null,
  assigneeAgentId: "agent-1",
  assigneeUserId: null,
  updatedAt: new Date("2026-04-10T00:00:00Z"),
};

describe("issue run scope routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockIssueService.getCommentCursor.mockResolvedValue({
      totalComments: 0,
      latestCommentId: null,
      latestCommentAt: null,
    });
    mockIssueService.getComment.mockResolvedValue(null);
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      contextSnapshot: {
        issueId: "22222222-2222-4222-8222-222222222222",
      },
    });
  });

  it("blocks heartbeat-context reads for a different bound issue", async () => {
    const res = await request(createApp()).get("/api/issues/11111111-1111-4111-8111-111111111111/heartbeat-context");

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "Agent run is bound to a different issue",
      boundIssueId: "22222222-2222-4222-8222-222222222222",
      requestedIssueId: "11111111-1111-4111-8111-111111111111",
      requestedIssueIdentifier: "PAP-777",
    });
  });

  it("blocks issue updates for a different bound issue", async () => {
    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "in_progress" });

    expect(res.status).toBe(409);
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });
});
