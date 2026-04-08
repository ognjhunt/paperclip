import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres checkout service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.checkout", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issues-checkout-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyWithAgents() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: agentId,
        companyId,
        name: "Review Agent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        companyId,
        name: "Other Agent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    return { companyId, agentId, otherAgentId };
  }

  it("returns 422 when a terminal issue is checked out again", async () => {
    const { companyId, agentId } = await seedCompanyWithAgents();
    const issueId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Closed issue",
      status: "done",
      priority: "medium",
    });

    await expect(
      svc.checkout(issueId, agentId, ["todo", "backlog", "blocked", "in_progress", "in_review"], randomUUID()),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Issue cannot be checked out from status "done"'),
    });
  });

  it("returns 409 when another agent already owns the checkout", async () => {
    const { companyId, agentId, otherAgentId } = await seedCompanyWithAgents();
    const issueId = randomUUID();
    const checkoutRunId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: checkoutRunId,
      companyId,
      agentId: otherAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: { issueId },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Already owned",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: otherAgentId,
      checkoutRunId,
      executionRunId: checkoutRunId,
    });

    await expect(
      svc.checkout(issueId, agentId, ["todo", "backlog", "blocked", "in_progress", "in_review"], randomUUID()),
    ).rejects.toMatchObject({
      status: 409,
      message: "Issue is already checked out by another agent",
    });
  });

  it("adopts a stale checkout when the old run is missing", async () => {
    const { companyId, agentId } = await seedCompanyWithAgents();
    const issueId = randomUUID();
    const staleRunId = randomUUID();
    const freshRunId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: staleRunId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "failed",
      contextSnapshot: { issueId },
    });
    await db.insert(heartbeatRuns).values({
      id: freshRunId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: { issueId },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Stale checkout",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: staleRunId,
      executionRunId: staleRunId,
    });

    const updated = await svc.checkout(
      issueId,
      agentId,
      ["todo", "backlog", "blocked", "in_progress", "in_review"],
      freshRunId,
    );

    expect(updated.checkoutRunId).toBe(freshRunId);
    expect(updated.executionRunId).toBe(freshRunId);
  });
});
