import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneDatabaseBackups } from "./backup-lib.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    try {
      statSync(target);
    } catch {
      continue;
    }
    rmSync(target, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `paperclip-backup-prune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  cleanupPaths.push(dir);
  return dir;
}

describe("pruneDatabaseBackups", () => {
  it("deletes only stale backups that match the prefix", () => {
    const dir = makeTempDir();
    const stale = path.join(dir, "paperclip-20260301-000000.sql");
    const fresh = path.join(dir, "paperclip-20260409-000000.sql");
    const other = path.join(dir, "other-20260301-000000.sql");

    writeFileSync(stale, "stale");
    writeFileSync(fresh, "fresh");
    writeFileSync(other, "other");

    const now = new Date("2026-04-09T20:00:00Z");
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    utimesSync(stale, tenDaysAgo, tenDaysAgo);
    utimesSync(fresh, oneDayAgo, oneDayAgo);
    utimesSync(other, tenDaysAgo, tenDaysAgo);

    const realNow = Date.now;
    Date.now = () => now.getTime();
    try {
      expect(pruneDatabaseBackups(dir, 7, "paperclip")).toBe(1);
    } finally {
      Date.now = realNow;
    }

    expect(() => statSync(stale)).toThrow();
    expect(statSync(fresh).isFile()).toBe(true);
    expect(statSync(other).isFile()).toBe(true);
  });
});
