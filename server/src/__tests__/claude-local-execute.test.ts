import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@paperclipai/adapter-claude-local/server";

async function writeFakeClaudeCommand(commandPath: string, options: { extraStdoutLines?: string[] } = {}) {
  const extraStdout = (options.extraStdoutLines ?? [])
    .map((line) => `console.log(${JSON.stringify(line)});`)
    .join("\n");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  paperclipEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
${extraStdout}
console.log(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "claude-session-1",
  model: "sonnet",
}));
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  session_id: "claude-session-1",
  result: "ok",
}));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("claude execute", () => {
  it("redacts printenv-style secret output in adapter log chunks and result payloads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-redaction-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "claude");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeClaudeCommand(commandPath, {
      extraStdoutLines: [
        "PAPERCLIP_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
        "PAPERCLIP_AGENT_JWT_SECRET=super-secret-value",
        "Authorization: Bearer sk-test-123456",
        "PAPERCLIP_TASK_ID=task-123",
      ],
    });

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
      const result = await execute({
        runId: "run-redaction",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Claude Coder",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Follow the paperclip heartbeat.",
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const stdoutLogs = logs
        .filter((entry) => entry.stream === "stdout")
        .map((entry) => entry.chunk)
        .join("");
      expect(stdoutLogs).toContain("PAPERCLIP_API_KEY=***REDACTED***");
      expect(stdoutLogs).toContain("PAPERCLIP_AGENT_JWT_SECRET=***REDACTED***");
      expect(stdoutLogs).toContain("Authorization: Bearer ***REDACTED***");
      expect(stdoutLogs).toContain("PAPERCLIP_TASK_ID=task-123");
      expect(stdoutLogs).not.toContain("payload.signature");
      expect(stdoutLogs).not.toContain("super-secret-value");
      expect(stdoutLogs).not.toContain("sk-test-123456");

      expect(JSON.stringify(result.resultJson)).not.toContain("PAPERCLIP_API_KEY=");
      expect(JSON.stringify(result.resultJson)).not.toContain("payload.signature");
      expect(JSON.stringify(result.resultJson)).not.toContain("super-secret-value");
      expect(JSON.stringify(result.resultJson)).not.toContain("sk-test-123456");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
