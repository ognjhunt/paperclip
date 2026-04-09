import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "hermes-paperclip-adapter/server";

async function writeFakeHermesCommand(commandPath: string, source: string) {
  await fs.writeFile(
    commandPath,
    `#!/usr/bin/env node
${source}
`,
    "utf8",
  );
  await fs.chmod(commandPath, 0o755);
}

describe("hermes execute", () => {
  it("falls through to the next configured model on OpenRouter 429s", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-execute-"));
    const commandPath = path.join(root, "hermes");
    const modelsLogPath = path.join(root, "models.log");

    await writeFakeHermesCommand(
      commandPath,
      `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("hermes-test 0.0.0");
  process.exit(0);
}
const modelIndex = args.indexOf("-m");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "missing-model";
fs.appendFileSync(${JSON.stringify(modelsLogPath)}, model + "\\n");
if (model === "arcee-ai/trinity-large-preview:free") {
  console.log("⚠️  API call failed (attempt 1/3): RateLimitError [HTTP 429]");
  console.log("🔌 Provider: openrouter  Model: arcee-ai/trinity-large-preview:free");
  console.log("📝 Error: HTTP 429: Rate limit exceeded: free-models-per-min.");
  console.log("API call failed after 3 retries: HTTP 429: Rate limit exceeded: free-models-per-min.");
  console.log("session_id: sess-rate-limited");
  process.exit(0);
}
console.log("Completed the assigned Paperclip issue.");
console.log("session_id: sess-success");
`,
    );

    const logs: string[] = [];
    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Test Agent",
        adapterConfig: {
          hermesCommand: commandPath,
          cwd: root,
          model: "arcee-ai/trinity-large-preview:free",
          provider: "openrouter",
          blueprintHermesModelLadder: [
            "arcee-ai/trinity-large-preview:free",
            "z-ai/glm-5.1",
          ],
          persistSession: false,
        },
      },
      runtime: {},
      config: {},
      onLog: async (_stream: string, chunk: string) => {
        logs.push(chunk);
      },
    } as never);

    expect(result.errorMessage).toBeUndefined();
    expect(result.model).toBe("z-ai/glm-5.1");
    expect(result.resultJson).toMatchObject({
      attempted_models: [
        "arcee-ai/trinity-large-preview:free",
        "z-ai/glm-5.1",
      ],
    });
    expect(logs.join("")).toContain("Falling through to z-ai/glm-5.1");
    expect(await fs.readFile(modelsLogPath, "utf8")).toBe(
      "arcee-ai/trinity-large-preview:free\nz-ai/glm-5.1\n",
    );
  });

  it("never defaults back to a Claude model when Hermes config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-default-"));
    const commandPath = path.join(root, "hermes");
    const modelsLogPath = path.join(root, "models.log");

    await writeFakeHermesCommand(
      commandPath,
      `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("hermes-test 0.0.0");
  process.exit(0);
}
const modelIndex = args.indexOf("-m");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "missing-model";
fs.appendFileSync(${JSON.stringify(modelsLogPath)}, model + "\\n");
console.log("Used model " + model);
console.log("session_id: sess-default");
`,
    );

    const result = await execute({
      runId: "run-2",
      agent: {
        id: "agent-2",
        companyId: "company-1",
        name: "Hermes Default Agent",
        adapterConfig: {
          hermesCommand: commandPath,
          cwd: root,
          persistSession: false,
        },
      },
      runtime: {},
      config: {},
      onLog: async () => {},
    } as never);

    expect(result.model).toBe("openrouter/free");
    expect(await fs.readFile(modelsLogPath, "utf8")).toBe("openrouter/free\n");
  });
});
