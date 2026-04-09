import { mkdir, mkdtemp, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneRunLogs } from "../services/run-log-retention.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map(async (dir) => {
      await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
    }),
  );
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paperclip-run-log-prune-"));
  cleanupDirs.push(dir);
  return dir;
}

describe("pruneRunLogs", () => {
  it("removes only stale ndjson logs and prunes empty directories", async () => {
    const root = await makeTempDir();
    const companyDir = path.join(root, "company", "agent");
    await mkdir(companyDir, { recursive: true });

    const staleLog = path.join(companyDir, "stale.ndjson");
    const freshLog = path.join(companyDir, "fresh.ndjson");
    const keepText = path.join(companyDir, "note.txt");

    await writeFile(staleLog, "stale");
    await writeFile(freshLog, "fresh");
    await writeFile(keepText, "keep");

    const now = new Date("2026-04-09T20:00:00Z");
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    await utimes(staleLog, tenDaysAgo, tenDaysAgo);
    await utimes(freshLog, oneDayAgo, oneDayAgo);

    const realNow = Date.now;
    Date.now = () => now.getTime();
    try {
      const result = await pruneRunLogs(root, 7);
      expect(result.deletedFiles).toBe(1);
      expect(result.deletedBytes).toBeGreaterThan(0);
    } finally {
      Date.now = realNow;
    }

    await expect(stat(staleLog)).rejects.toThrow();
    await expect(stat(freshLog)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(stat(keepText)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });
});
