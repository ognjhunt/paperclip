import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { pluginLoader } from "../services/plugin-loader.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempPluginDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paperclip-plugin-loader-"));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(pluginDir: string, jobs: string[]) {
  const manifestSource = `export default ${JSON.stringify({
    id: "test.plugin",
    apiVersion: 1,
    version: "0.0.1",
    displayName: "Test Plugin",
    description: "test",
    author: "test",
    categories: ["automation"],
    capabilities: ["jobs.schedule"],
    entrypoints: {
      worker: "./dist/worker.js",
    },
    jobs: jobs.map((jobKey) => ({
      jobKey,
      displayName: jobKey,
      description: jobKey,
      schedule: "*/5 * * * *",
    })),
  }, null, 2)};\n`;

  writeFileSync(path.join(pluginDir, "dist", "manifest.js"), manifestSource);
}

describe("pluginLoader.loadManifest", () => {
  it("reloads a local manifest after the file changes in the same process", async () => {
    const pluginDir = makeTempPluginDir();
    mkdirSync(path.join(pluginDir, "dist"), { recursive: true });
    writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "@acme/test-plugin",
        paperclipPlugin: {
          manifest: "./dist/manifest.js",
          worker: "./dist/worker.js",
        },
      }),
    );
    writeFileSync(path.join(pluginDir, "dist", "worker.js"), "export default {};\n");

    writeManifest(pluginDir, ["job-a"]);
    const loader = pluginLoader({} as never);

    const first = await loader.loadManifest(pluginDir);
    expect(first?.jobs?.map((job) => job.jobKey)).toEqual(["job-a"]);

    await sleep(20);
    writeManifest(pluginDir, ["job-a", "job-b"]);

    const second = await loader.loadManifest(pluginDir);
    expect(second?.jobs?.map((job) => job.jobKey)).toEqual(["job-a", "job-b"]);
  });
});
