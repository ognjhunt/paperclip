import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectPostmasterPidFile, waitForPostmasterPidSettle } from "./embedded-postgres-startup.js";

describe("embedded postgres startup helpers", () => {
  it("classifies an empty postmaster.pid as empty", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-db-postmaster-empty-"));
    try {
      const filePath = path.join(tempDir, "postmaster.pid");
      await writeFile(filePath, "\n", "utf8");
      expect(inspectPostmasterPidFile(filePath)).toEqual({
        status: "empty",
        pid: null,
        firstLine: "",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses an instance that becomes reachable while the pid file settles", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-db-postmaster-reuse-"));
    try {
      const filePath = path.join(tempDir, "postmaster.pid");
      await writeFile(filePath, "\n", "utf8");

      let probeCount = 0;
      const result = await waitForPostmasterPidSettle({
        postmasterPidFile: filePath,
        attempts: 3,
        delayMs: 1,
        probeReachable: async () => {
          probeCount += 1;
          return probeCount >= 2;
        },
        sleep: async () => {},
      });

      expect(result.action).toBe("reuse");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks cleanup while a postmaster pid is still running but unreachable", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-db-postmaster-running-"));
    try {
      const filePath = path.join(tempDir, "postmaster.pid");
      await writeFile(filePath, "12345\n", "utf8");

      const result = await waitForPostmasterPidSettle({
        postmasterPidFile: filePath,
        attempts: 2,
        delayMs: 1,
        probeReachable: async () => false,
        isPidRunning: () => true,
        sleep: async () => {},
      });

      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.state.pid).toBe(12345);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("cleans up stale pid files after settle retries are exhausted", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-db-postmaster-stale-"));
    try {
      const filePath = path.join(tempDir, "postmaster.pid");
      await writeFile(filePath, "54321\n", "utf8");

      const result = await waitForPostmasterPidSettle({
        postmasterPidFile: filePath,
        attempts: 2,
        delayMs: 1,
        probeReachable: async () => false,
        isPidRunning: () => false,
        sleep: async () => {},
      });

      expect(result).toEqual({
        action: "cleanup",
        state: {
          status: "stale",
          pid: 54321,
          firstLine: "54321",
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
