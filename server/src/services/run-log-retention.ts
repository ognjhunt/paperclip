import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../middleware/logger.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1_000;

type PruneStats = {
  deletedFiles: number;
  deletedBytes: number;
};

function normalizeBasePath(basePath?: string) {
  return path.resolve(
    basePath
      ?? process.env.RUN_LOG_BASE_PATH
      ?? path.resolve(resolvePaperclipInstanceRoot(), "data", "run-logs"),
  );
}

async function pruneDirectory(dir: string, cutoffMs: number): Promise<PruneStats> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      return { deletedFiles: 0, deletedBytes: 0 };
    }
    throw error;
  }

  let deletedFiles = 0;
  let deletedBytes = 0;

  for (const entry of entries) {
    const entryName = String(entry.name);
    const fullPath = path.join(dir, entryName);
    if (entry.isDirectory()) {
      const child = await pruneDirectory(fullPath, cutoffMs);
      deletedFiles += child.deletedFiles;
      deletedBytes += child.deletedBytes;
      try {
        const remaining = await fs.readdir(fullPath);
        if (remaining.length === 0) {
          await fs.rmdir(fullPath);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY") {
          throw error;
        }
      }
      continue;
    }

    if (!entry.isFile() || !entryName.endsWith(".ndjson")) {
      continue;
    }

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoffMs) {
      continue;
    }

    await fs.unlink(fullPath).catch((error) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    });
    deletedFiles += 1;
    deletedBytes += stat.size;
  }

  return { deletedFiles, deletedBytes };
}

export async function pruneRunLogs(
  basePath?: string,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<PruneStats> {
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays));
  const cutoffMs = Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000;
  const resolvedBasePath = normalizeBasePath(basePath);
  const result = await pruneDirectory(resolvedBasePath, cutoffMs);

  if (result.deletedFiles > 0) {
    logger.info(
      {
        deletedFiles: result.deletedFiles,
        deletedBytes: result.deletedBytes,
        retentionDays: safeRetentionDays,
        basePath: resolvedBasePath,
      },
      "Pruned expired run logs",
    );
  }

  return result;
}

export function startRunLogRetention(
  basePath?: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): () => void {
  const safeIntervalMs = Math.max(60_000, Math.trunc(intervalMs));
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays));

  const runSweep = () => {
    pruneRunLogs(basePath, safeRetentionDays).catch((error) => {
      logger.warn({ err: error, retentionDays: safeRetentionDays }, "Run log retention sweep failed");
    });
  };

  void runSweep();
  const timer = setInterval(runSweep, safeIntervalMs);
  return () => clearInterval(timer);
}
