import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { ensurePostgresDatabase, getPostgresDataDirectory } from "./client.js";
import { createEmbeddedPostgresLogBuffer, formatEmbeddedPostgresError } from "./embedded-postgres-error.js";
import { inspectPostmasterPidFile, waitForPostmasterPidSettle } from "./embedded-postgres-startup.js";
import { resolveDatabaseTarget } from "./runtime-config.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

export type MigrationConnection = {
  connectionString: string;
  source: string;
  stop: () => Promise<void>;
};

function readPidFilePort(postmasterPidFile: string): number | null {
  if (!existsSync(postmasterPidFile)) return null;
  try {
    const lines = readFileSync(postmasterPidFile, "utf8").split("\n");
    const port = Number(lines[3]?.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function isPortInUse(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code === "EADDRINUSE");
    });
    server.listen(port, "127.0.0.1", () => {
      server.close();
      resolve(false);
    });
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  const maxLookahead = 20;
  let port = startPort;
  for (let i = 0; i < maxLookahead; i += 1, port += 1) {
    if (!(await isPortInUse(port))) return port;
  }
  throw new Error(
    `Embedded PostgreSQL could not find a free port from ${startPort} to ${startPort + maxLookahead - 1}`,
  );
}

async function loadEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  try {
    const mod = await import("embedded-postgres");
    return mod.default as EmbeddedPostgresCtor;
  } catch {
    throw new Error(
      "Embedded PostgreSQL support requires dependency `embedded-postgres`. Reinstall dependencies and try again.",
    );
  }
}

async function ensureEmbeddedPostgresConnection(
  dataDir: string,
  preferredPort: number,
): Promise<MigrationConnection> {
  const EmbeddedPostgres = await loadEmbeddedPostgresCtor();
  const postmasterPidFile = path.resolve(dataDir, "postmaster.pid");
  const pgVersionFile = path.resolve(dataDir, "PG_VERSION");
  const logBuffer = createEmbeddedPostgresLogBuffer();
  let reusablePort: number | null = null;

  const tryReuseEmbeddedServer = async (): Promise<boolean> => {
    const candidatePorts = [preferredPort, readPidFilePort(postmasterPidFile)].filter(
      (value, index, values): value is number => value != null && values.indexOf(value) === index,
    );

    for (const port of candidatePorts) {
      const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
      try {
        const actualDataDir = await getPostgresDataDirectory(adminConnectionString);
        const matchesDataDir =
          typeof actualDataDir === "string" &&
          path.resolve(actualDataDir) === path.resolve(dataDir);
        if (!matchesDataDir) continue;
        await ensurePostgresDatabase(adminConnectionString, "paperclip");
        reusablePort = port;
        return true;
      } catch {
        continue;
      }
    }

    reusablePort = null;
    return false;
  };

  let stalePidState: ReturnType<typeof inspectPostmasterPidFile> | null = null;
  let reusedPort: number | null = null;

  if (existsSync(postmasterPidFile)) {
    const settleResult = await waitForPostmasterPidSettle({
      postmasterPidFile,
      probeReachable: tryReuseEmbeddedServer,
    });
    if (settleResult.action === "reuse" && reusablePort != null) {
      reusedPort = reusablePort;
    } else if (settleResult.action === "block") {
      throw new Error(
        `Embedded PostgreSQL process ${settleResult.state.pid} is still present for ${dataDir} but no matching server became reachable. Refusing to remove postmaster.pid or start a second instance.`,
      );
    } else {
      stalePidState = settleResult.state;
    }
  } else if (existsSync(pgVersionFile) && await tryReuseEmbeddedServer()) {
    reusedPort = reusablePort;
  }

  if (reusedPort != null) {
    if (reusedPort === preferredPort && !existsSync(postmasterPidFile)) {
      process.emitWarning(
        `Adopting an existing PostgreSQL instance on port ${preferredPort} for embedded data dir ${dataDir} because postmaster.pid is missing.`,
      );
    }
    return {
      connectionString: `postgres://paperclip:paperclip@127.0.0.1:${reusedPort}/paperclip`,
      source: `embedded-postgres@${reusedPort}`,
      stop: async () => {},
    };
  }

  const selectedPort = await findAvailablePort(preferredPort);
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port: selectedPort,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
    onLog: logBuffer.append,
    onError: logBuffer.append,
  });

  if (!existsSync(path.resolve(dataDir, "PG_VERSION"))) {
    try {
      await instance.initialise();
    } catch (error) {
      throw formatEmbeddedPostgresError(error, {
        fallbackMessage:
          `Failed to initialize embedded PostgreSQL cluster in ${dataDir} on port ${selectedPort}`,
        recentLogs: logBuffer.getRecentLogs(),
      });
    }
  }
  if (existsSync(postmasterPidFile)) {
    process.emitWarning(
      `Removing stale embedded PostgreSQL lock file for ${dataDir} (state=${stalePidState?.status ?? "present"}, firstLine=${stalePidState?.firstLine ?? "n/a"}).`,
    );
    rmSync(postmasterPidFile, { force: true });
  }
  try {
    await instance.start();
  } catch (error) {
    throw formatEmbeddedPostgresError(error, {
      fallbackMessage: `Failed to start embedded PostgreSQL on port ${selectedPort}`,
      recentLogs: logBuffer.getRecentLogs(),
    });
  }

  const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${selectedPort}/postgres`;
  await ensurePostgresDatabase(adminConnectionString, "paperclip");

  return {
    connectionString: `postgres://paperclip:paperclip@127.0.0.1:${selectedPort}/paperclip`,
    source: `embedded-postgres@${selectedPort}`,
    stop: async () => {
      await instance.stop();
    },
  };
}

export async function resolveMigrationConnection(): Promise<MigrationConnection> {
  const target = resolveDatabaseTarget();
  if (target.mode === "postgres") {
    return {
      connectionString: target.connectionString,
      source: target.source,
      stop: async () => {},
    };
  }

  return ensureEmbeddedPostgresConnection(target.dataDir, target.port);
}
